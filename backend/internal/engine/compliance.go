package engine

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/store"
)

// Compliance engine.
//
// Kenyan commercial fleet compliance is a calendar problem disguised as a
// paperwork problem: NTSA inspections, governor recalibration, insurance, transit
// licences, county permits, KRA filings and emissions certificates all fall due on
// independent clocks. This engine puts them on one timeline, ranks them by money
// at risk rather than by date alone, and emits tiered reminders 30, 7 and 1 day out.

// PenaltyExposureKes is the statutory fine per category, used to rank urgency.
var PenaltyExposureKes = map[domain.ComplianceCategory]float64{
	domain.CategoryNTASInspection: 50_000,
	domain.CategorySpeedGovernor:  30_000,
	domain.CategoryInsurance:      80_000,
	domain.CategoryTransitLicence: 40_000,
	domain.CategoryCountyPermit:   25_000,
	domain.CategoryKRATax:         60_000,
	domain.CategoryEmission:       20_000,
}

// DowntimePerDayKes is what an impounded vehicle costs the operator per day.
const DowntimePerDayKes = 12_000

// CategoryLabels are the human names the console renders.
var CategoryLabels = map[domain.ComplianceCategory]string{
	domain.CategoryNTASInspection: "NTSA inspection",
	domain.CategorySpeedGovernor:  "Speed governor",
	domain.CategoryInsurance:      "Insurance",
	domain.CategoryTransitLicence: "Transit licence",
	domain.CategoryCountyPermit:   "County permit",
	domain.CategoryKRATax:         "KRA filing",
	domain.CategoryEmission:       "Emissions",
}

// CategoryOrder is a stable display order.
var CategoryOrder = []domain.ComplianceCategory{
	domain.CategoryNTASInspection,
	domain.CategorySpeedGovernor,
	domain.CategoryInsurance,
	domain.CategoryTransitLicence,
	domain.CategoryCountyPermit,
	domain.CategoryKRATax,
	domain.CategoryEmission,
}

// EvaluateItem computes urgency and money at risk for one obligation.
func EvaluateItem(item domain.ComplianceItem, now time.Time) domain.ComplianceEvaluation {
	days := int(math.Floor(item.DueDate.Sub(now).Hours() / 24))

	status := domain.ComplianceOK
	switch {
	case days < 0:
		status = domain.ComplianceExpired
	case days <= 7:
		status = domain.ComplianceCritical
	case days <= item.LeadDays:
		status = domain.ComplianceDueSoon
	}

	// Money at risk grows as the deadline closes: a statutory fine plus two days
	// of downtime while the vehicle sits idle waiting on paperwork.
	exposure := 0.0
	if status != domain.ComplianceOK {
		exposure = PenaltyExposureKes[item.Category]
		if days < 0 {
			exposure += DowntimePerDayKes * 2
		}
	}

	return domain.ComplianceEvaluation{
		ComplianceItem:     item,
		Status:             status,
		DaysRemaining:      days,
		PenaltyExposureKes: exposure,
	}
}

// EvaluateAll evaluates every obligation on one vehicle, most urgent first.
func EvaluateAll(st *store.Store, vehicleID string, now time.Time) []domain.ComplianceEvaluation {
	items := st.ComplianceFor(vehicleID)
	out := make([]domain.ComplianceEvaluation, 0, len(items))
	for _, item := range items {
		out = append(out, EvaluateItem(item, now))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DaysRemaining < out[j].DaysRemaining })
	return out
}

// WorstStatus returns the most serious status in a set.
func WorstStatus(items []domain.ComplianceEvaluation) domain.ComplianceStatus {
	worst := domain.ComplianceOK
	for _, item := range items {
		if statusRank(item.Status) > statusRank(worst) {
			worst = item.Status
		}
	}
	return worst
}

func statusRank(s domain.ComplianceStatus) int {
	switch s {
	case domain.ComplianceExpired:
		return 3
	case domain.ComplianceCritical:
		return 2
	case domain.ComplianceDueSoon:
		return 1
	default:
		return 0
	}
}

// PostureSummary is the fleet-wide compliance picture.
type PostureSummary struct {
	Expired        int                            `json:"expired"`
	Critical       int                            `json:"critical"`
	DueSoon        int                            `json:"dueSoon"`
	OK             int                            `json:"ok"`
	Total          int                            `json:"total"`
	ExposureKes    float64                        `json:"exposureKes"`
	HealthyPercent int                            `json:"healthyPercent"`
	RiskScore      int                            `json:"riskScore"`
	Evaluations    []domain.ComplianceEvaluation  `json:"evaluations"`
}

// Summarise aggregates a set of evaluations.
func Summarise(items []domain.ComplianceEvaluation) PostureSummary {
	summary := PostureSummary{}
	for _, item := range items {
		switch item.Status {
		case domain.ComplianceExpired:
			summary.Expired++
		case domain.ComplianceCritical:
			summary.Critical++
		case domain.ComplianceDueSoon:
			summary.DueSoon++
		default:
			summary.OK++
		}
		summary.ExposureKes += item.PenaltyExposureKes
	}

	total := len(items)
	if total == 0 {
		total = 1
	}
	summary.Total = len(items)
	summary.HealthyPercent = int(math.Round(float64(summary.OK) / float64(total) * 100))
	summary.ExposureKes = math.Round(summary.ExposureKes)

	vehicleCount := float64(total) / 7
	if vehicleCount < 1 {
		vehicleCount = 1
	}
	score := 100 - (float64(summary.Expired)*18+float64(summary.Critical)*9+float64(summary.DueSoon)*3)/vehicleCount
	summary.RiskScore = int(math.Max(0, math.Min(100, math.Round(score))))
	return summary
}

// FleetCompliancePosture evaluates the whole book.
func FleetCompliancePosture(st *store.Store, now time.Time) PostureSummary {
	items := st.AllCompliance()
	evaluations := make([]domain.ComplianceEvaluation, 0, len(items))
	for _, item := range items {
		evaluations = append(evaluations, EvaluateItem(item, now))
	}
	summary := Summarise(evaluations)
	summary.Evaluations = evaluations
	return summary
}

// BuildAlertQueue produces the outbound reminder queue. Tiers fire at T-30, T-7
// and T-1, then daily once the item is overdue.
func BuildAlertQueue(st *store.Store, now time.Time) []domain.ComplianceAlert {
	var alerts []domain.ComplianceAlert

	for _, item := range st.AllCompliance() {
		evaluation := EvaluateItem(item, now)
		days := evaluation.DaysRemaining

		var tier domain.AlertTier
		switch {
		case days < 0:
			tier = domain.TierOverdue
		case days <= 1:
			tier = domain.Tier1
		case days <= 7:
			tier = domain.Tier7
		case days <= item.LeadDays:
			tier = domain.Tier30
		default:
			continue
		}

		plate := item.VehicleID
		if vehicle, ok := st.Vehicle(item.VehicleID); ok {
			plate = vehicle.Plate
		}

		// Statutory safety items go to a driver-facing channel; paperwork goes
		// to the office.
		channel := domain.ChannelEmail
		if item.Category == domain.CategoryNTASInspection || item.Category == domain.CategorySpeedGovernor {
			channel = domain.ChannelWhatsApp
		}

		var when string
		switch {
		case days < 0:
			plural := "s"
			if days == -1 {
				plural = ""
			}
			when = fmt.Sprintf("expired %d day%s ago", -days, plural)
		case days == 0:
			when = "is due today"
		default:
			plural := "s"
			if days == 1 {
				plural = ""
			}
			when = fmt.Sprintf("is due in %d day%s", days, plural)
		}

		label := "Reminder"
		if tier == domain.TierOverdue {
			label = "OVERDUE"
		}

		alerts = append(alerts, domain.ComplianceAlert{
			ID:            fmt.Sprintf("alr_%s_%s", item.ID, tier),
			ItemID:        item.ID,
			VehicleID:     item.VehicleID,
			DueDate:       item.DueDate,
			DaysRemaining: days,
			Channel:       channel,
			Tier:          tier,
			Message: fmt.Sprintf("%s: %s — %s %s (%s). Estimated exposure KES %s.",
				label, plate, item.Title, when, item.Authority,
				formatThousands(evaluation.PenaltyExposureKes)),
		})
	}

	sort.Slice(alerts, func(i, j int) bool { return alerts[i].DaysRemaining < alerts[j].DaysRemaining })
	return alerts
}

// formatThousands renders an integer with thousands separators, matching the
// console's number formatting.
func formatThousands(v float64) string {
	n := int64(math.Round(v))
	neg := n < 0
	if neg {
		n = -n
	}
	digits := fmt.Sprintf("%d", n)
	var out []byte
	for i, c := range []byte(digits) {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}
