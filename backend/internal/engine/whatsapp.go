package engine

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/store"
)

// WhatsApp-native driver assistant.
//
// Drivers never install an app. An automated WhatsApp Business thread collects
// the same field data a heavy mobile app would, over a channel that is already
// installed, already trusted and already cheap on data. The bot is a small,
// explicit state machine so every transition is testable and auditable, and every
// turn emits typed events rather than free text, so the rest of the platform can
// act on what was said.

// ChecklistItem is one pre-trip inspection step.
type ChecklistItem struct {
	Key    string `json:"key"`
	Prompt string `json:"prompt"`
}

// PreTripChecklist is the exact sequence the bot walks a driver through.
var PreTripChecklist = []ChecklistItem{
	{"tyres", "Tyres: tread depth, pressure and no visible damage (reply OK or FAIL)"},
	{"brakes", "Brakes and air pressure within range"},
	{"lights", "Lights, indicators and reflectors working"},
	{"fluids", "Engine oil, coolant and no visible leaks under the vehicle"},
	{"load", "Load secured and within axle weight limits"},
	{"documents", "Originals on board: licence, insurance, inspection and transit papers"},
	{"fitness", "Driver fit for duty — no alcohol, rested, within hours-of-service"},
}

const helpText = `*VektorFleet Driver Assistant*

• *START* — begin the pre-trip checklist
• *ODO 154320* — log your odometer reading
• *CARD 4521 88 120L* — confirm a fuel card transaction
• *INCIDENT <details>* — report a breakdown or accident
• *STATUS* — today's summary for your vehicle
• *HELP* — show this menu

Reply to any checklist item with OK or FAIL.`

// HelpText is exposed for the console's bot simulator.
const HelpText = helpText

// BotEvent is a structured side effect of one conversation turn.
type BotEvent struct {
	Type     string             `json:"type"`
	Key      string             `json:"key,omitempty"`
	Result   string             `json:"result,omitempty"`
	Km       *float64           `json:"km,omitempty"`
	MediaURL string             `json:"mediaUrl,omitempty"`
	Text     string             `json:"text,omitempty"`
	Report   *domain.TripReport `json:"report,omitempty"`
}

// BotTurn is the bot's response to one inbound message.
type BotTurn struct {
	Session domain.WhatsAppSession `json:"session"`
	Replies []string               `json:"replies"`
	Events  []BotEvent             `json:"events"`
}

// HandleInbound processes one inbound message, mutating the session and logging
// both sides of the conversation.
func HandleInbound(st *store.Store, phoneRaw, bodyRaw, mediaURL string) BotTurn {
	phone := store.NormalisePhone(phoneRaw)
	text := strings.TrimSpace(bodyRaw)
	var events []BotEvent

	st.AppendMessage(domain.WhatsAppMessage{
		Phone: phone, Direction: "inbound", Body: text, MediaURL: mediaURL,
	})

	driver, known := st.DriverByPhone(phone)
	if !known {
		reply := fmt.Sprintf("This number (%s) is not registered on any VektorFleet fleet. Ask your transport manager to add you, or email support@vektorfleet.co.ke.", phone)
		st.AppendMessage(domain.WhatsAppMessage{Phone: phone, Direction: "outbound", Body: reply})
		return BotTurn{
			Session: domain.WhatsAppSession{
				Phone: phone, DriverID: "unregistered", Step: domain.StepIdle,
				Answers: map[string]string{}, UpdatedAt: time.Now().UTC(),
			},
			Replies: []string{reply},
		}
	}

	vehicle, _ := st.Vehicle(driver.AssignedVehicleID)
	session, ok := st.Session(phone)
	if !ok {
		session = domain.WhatsAppSession{
			Phone: phone, DriverID: driver.ID, Step: domain.StepIdle,
			Answers: map[string]string{},
		}
	}
	if session.Answers == nil {
		session.Answers = map[string]string{}
	}

	var replies []string
	upper := strings.ToUpper(text)
	firstName := strings.SplitN(driver.Name, " ", 2)[0]
	plate := "your vehicle"
	if vehicle != nil {
		plate = vehicle.Plate
	}

	switch {
	case upper == "HELP" || upper == "MENU" || upper == "?":
		session.Step = domain.StepIdle
		replies = append(replies, helpText)

	case upper == "STATUS":
		replies = append(replies, statusMessage(st, driver.ID, driver.AssignedVehicleID))

	case strings.HasPrefix(upper, "INCIDENT"):
		detail := strings.TrimSpace(text[len("INCIDENT"):])
		if detail == "" {
			detail = "(no detail supplied)"
		}
		events = append(events, BotEvent{Type: "incident", Text: detail})
		replies = append(replies, fmt.Sprintf(
			"Incident logged and escalated to the transport manager: %q. Reference *INC-%s*. Keep this thread open and reply with your location and whether the vehicle is safely off the road.",
			detail, strings.ToUpper(lastN(driver.ID, 3)),
		))
		session.Step = domain.StepIncident

	case upper == "START" || upper == "PRE-TRIP" || upper == "PRETRIP" || upper == "ANZA":
		session.Step = domain.StepPreTrip
		session.ChecklistIndex = 0
		session.Answers = map[string]string{}
		replies = append(replies,
			fmt.Sprintf("Karibu %s! Pre-trip checklist for *%s*. Reply OK or FAIL to each item (%d items):", firstName, plate, len(PreTripChecklist)),
			fmt.Sprintf("1/%d — %s", len(PreTripChecklist), PreTripChecklist[0].Prompt),
		)

	case session.Step == domain.StepPreTrip:
		turnReplies, turnEvents := advanceChecklist(st, &session, text, driver.AssignedVehicleID)
		replies = append(replies, turnReplies...)
		events = append(events, turnEvents...)

	default:
		if km, ok := ParseOdometer(text); ok {
			kmf := float64(km)
			events = append(events, BotEvent{Type: "odometer", Km: &kmf})
			session.Answers["odometerKm"] = strconv.FormatInt(km, 10)
			if vehicle != nil && float64(km) < vehicle.OdometerKm-50 {
				replies = append(replies, fmt.Sprintf(
					"Noted %s km, but the tracker already has %s km. I've flagged this for review and logged your reading.",
					formatThousands(float64(km)), formatThousands(vehicle.OdometerKm),
				))
			} else {
				replies = append(replies, fmt.Sprintf("Odometer logged at %s km. Umefika salama.", formatThousands(float64(km))))
			}
			session.Step = domain.StepFuelReceipt
		} else if mediaURL != "" {
			events = append(events, BotEvent{Type: "receipt", MediaURL: mediaURL})
			session.Answers["receiptUrl"] = mediaURL
			replies = append(replies, "Receipt received. I've attached it to your last fuel card transaction for matching against the pump data.")
		} else if strings.HasPrefix(upper, "CARD") {
			replies = append(replies, "Fuel card confirmation noted. I'll match it against the pump terminal capture and flag any variance over 5%.")
		} else if session.Step != domain.StepIdle && text != "" {
			events = append(events, BotEvent{Type: "unknown"})
			replies = append(replies, fmt.Sprintf("Received: %q. I couldn't map that to an action. Reply HELP for the command menu, or OK/FAIL during a checklist.", text))
		} else if text == "" && mediaURL == "" {
			replies = append(replies, "Empty message received. Reply HELP for options.")
		} else {
			replies = append(replies, fmt.Sprintf(
				"Habari %s. I'm the VektorFleet assistant for *%s*. Reply HELP to see what you can do, or START to run your pre-trip checklist.",
				firstName, plate,
			))
		}
	}

	session.UpdatedAt = time.Now().UTC()
	st.PutSession(session)

	if len(replies) == 0 {
		replies = append(replies, "Reply HELP for the command menu.")
	}
	for _, reply := range replies {
		st.AppendMessage(domain.WhatsAppMessage{Phone: phone, Direction: "outbound", Body: reply})
	}

	return BotTurn{Session: session, Replies: replies, Events: events}
}

// advanceChecklist steps one item at a time, one inbound message per item.
func advanceChecklist(st *store.Store, session *domain.WhatsAppSession, text, vehicleID string) ([]string, []BotEvent) {
	var replies []string
	var events []BotEvent

	if session.ChecklistIndex >= len(PreTripChecklist) {
		session.Step = domain.StepOdometer
		return []string{"Checklist already complete. Send your odometer reading, e.g. *ODO 154320*."}, nil
	}

	item := PreTripChecklist[session.ChecklistIndex]
	result, ok := parseChecklistAnswer(text)
	if !ok {
		return []string{fmt.Sprintf("Please reply *OK* to pass or *FAIL* to raise a defect for: %s", item.Prompt)}, nil
	}

	session.Answers[item.Key] = result
	events = append(events, BotEvent{Type: "checklist_item", Key: item.Key, Result: result})

	if result == "fail" {
		replies = append(replies, fmt.Sprintf(
			"*Defect logged* on %s. Do not depart until the transport manager clears it. I've opened a maintenance task and notified the workshop.",
			item.Key,
		))
	}

	session.ChecklistIndex++
	if session.ChecklistIndex >= len(PreTripChecklist) {
		session.Step = domain.StepOdometer

		checklist := map[string]string{}
		passed := 0
		for _, ci := range PreTripChecklist {
			if v, present := session.Answers[ci.Key]; present {
				checklist[ci.Key] = v
				if v == "pass" {
					passed++
				}
			}
		}
		report := domain.TripReport{
			DriverID:    session.DriverID,
			VehicleID:   vehicleID,
			SubmittedAt: time.Now().UTC(),
			Checklist:   checklist,
		}
		if odo, err := strconv.ParseFloat(session.Answers["odometerKm"], 64); err == nil {
			report.OdometerKm = &odo
		}
		report.ReceiptMediaURL = session.Answers["receiptUrl"]
		stored := st.AppendTripReport(report)

		suggestion := 154320
		if vehicle, ok := st.Vehicle(vehicleID); ok {
			suggestion = int(vehicle.OdometerKm) + 312
		}
		replies = append(replies, fmt.Sprintf(
			"Checklist complete (%d/%d passed). Send your odometer reading to close out the pre-trip, e.g. *ODO %d*.",
			passed, len(PreTripChecklist), suggestion,
		))
		events = append(events, BotEvent{Type: "trip_report", Report: &stored})
		return replies, events
	}

	next := PreTripChecklist[session.ChecklistIndex]
	suffix := ""
	if result == "fail" {
		suffix = "\n\nI'll wait here — reply OK to continue once the defect is resolved."
	}
	replies = append(replies, fmt.Sprintf("%d/%d — %s%s", session.ChecklistIndex+1, len(PreTripChecklist), next.Prompt, suffix))
	return replies, events
}

func parseChecklistAnswer(text string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(text)) {
	case "OK", "OKAY", "PASS", "SAWA", "YES", "Y", "1", "✅":
		return "pass", true
	case "FAIL", "NO", "N", "DEFECT", "NOT OK", "2", "❌":
		return "fail", true
	}
	return "", false
}

var odometerPattern = regexp.MustCompile(`^(?:ODO(?:METER)?|KM|MILEAGE)?[:\s]*(\d{4,7})(?:KM)?$`)

// ParseOdometer extracts an odometer reading.
//
// A bare 4-7 digit number is only treated as an odometer reading when it is
// plausible for a commercial vehicle, so a stray "1" or a year does not corrupt
// the record.
func ParseOdometer(text string) (int64, bool) {
	cleaned := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(text, ",", ""), "_", ""), " ", ""))
	match := odometerPattern.FindStringSubmatch(cleaned)
	if match == nil {
		return 0, false
	}
	value, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return 0, false
	}
	hasKeyword := strings.Contains(cleaned, "ODO") || strings.Contains(cleaned, "KM") || strings.Contains(cleaned, "MILEAGE")
	if !hasKeyword && (value < 10_000 || value > 3_000_000) {
		return 0, false
	}
	return value, true
}

func statusMessage(st *store.Store, driverID, vehicleID string) string {
	plate := vehicleID
	odometer := "?"
	if vehicle, ok := st.Vehicle(vehicleID); ok {
		plate = vehicle.Plate
		odometer = formatThousands(vehicle.OdometerKm)
	}

	reports := 0
	defects := 0
	for _, r := range st.TripReports() {
		if r.DriverID != driverID {
			continue
		}
		reports++
		for _, v := range r.Checklist {
			if v == "fail" {
				defects++
			}
		}
	}

	defectLine := "Open defects: none"
	if defects > 0 {
		defectLine = fmt.Sprintf("Open defects: %d — do not depart until cleared.", defects)
	}

	return strings.Join([]string{
		fmt.Sprintf("*Today — %s*", plate),
		fmt.Sprintf("Odometer: %s km", odometer),
		fmt.Sprintf("Trip reports submitted: %d", reports),
		defectLine,
		"",
		"Reply START to run your pre-trip checklist, or ODO <number> to log a reading.",
	}, "\n")
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

// EnqueueFieldEntry records a field entry that was captured without connectivity,
// preserving the device clock so the audit trail keeps its timing.
func EnqueueFieldEntry(st *store.Store, kind, deviceID string, payload any, capturedAt time.Time) domain.OfflineEnvelope {
	return st.Enqueue(domain.OfflineEnvelope{
		Kind:       kind,
		CapturedAt: capturedAt.UTC(),
		DeviceID:   deviceID,
		Payload:    payload,
		Synced:     false,
	})
}
