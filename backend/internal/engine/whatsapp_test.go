package engine

import (
	"strings"
	"testing"
	"time"

	"github.com/vektorfleet/backend/internal/store"
)

func firstDriverPhone(st *store.Store) string {
	return st.Dataset().Drivers[0].Phone
}

func TestBotRejectsUnregisteredNumber(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	turn := HandleInbound(st, "+254700000000", "START", "")
	if turn.Session.DriverID != "unregistered" {
		t.Errorf("expected unregistered driver, got %q", turn.Session.DriverID)
	}
	if len(turn.Replies) == 0 || !strings.Contains(strings.ToLower(turn.Replies[0]), "not registered") {
		t.Errorf("expected a registration hint, got %v", turn.Replies)
	}
}

func TestBotHelpAndStartFlow(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	phone := firstDriverPhone(st)

	help := HandleInbound(st, phone, "HELP", "")
	if len(help.Replies) == 0 || !strings.Contains(help.Replies[0], "START") {
		t.Errorf("HELP should list commands, got %v", help.Replies)
	}

	start := HandleInbound(st, phone, "START", "")
	if start.Session.Step != "PRE_TRIP" {
		t.Errorf("START should enter PRE_TRIP, got %s", start.Session.Step)
	}
	if start.Session.ChecklistIndex != 0 {
		t.Errorf("START should reset the checklist index, got %d", start.Session.ChecklistIndex)
	}
}

func TestChecklistAdvancesOneItemPerMessage(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	phone := firstDriverPhone(st)
	HandleInbound(st, phone, "START", "")

	for i := 0; i < len(PreTripChecklist); i++ {
		turn := HandleInbound(st, phone, "OK", "")
		if i < len(PreTripChecklist)-1 {
			if turn.Session.ChecklistIndex != i+1 {
				t.Fatalf("after %d answers index should be %d, got %d", i+1, i+1, turn.Session.ChecklistIndex)
			}
		}
	}
}

func TestCompletedChecklistEmitsTripReport(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	phone := firstDriverPhone(st)
	HandleInbound(st, phone, "START", "")

	var report *BotTurn
	for i := 0; i < len(PreTripChecklist); i++ {
		turn := HandleInbound(st, phone, "OK", "")
		copied := turn
		report = &copied
	}
	if report == nil {
		t.Fatal("no final turn produced")
	}
	if report.Session.Step != "ODOMETER" {
		t.Errorf("a completed checklist should move to ODOMETER, got %s", report.Session.Step)
	}

	foundReport := false
	for _, e := range report.Events {
		if e.Type == "trip_report" && e.Report != nil {
			foundReport = true
			if len(e.Report.Checklist) != len(PreTripChecklist) {
				t.Errorf("report should carry %d answers, got %d", len(PreTripChecklist), len(e.Report.Checklist))
			}
		}
	}
	if !foundReport {
		t.Errorf("expected a trip_report event, got %+v", report.Events)
	}
}

func TestFailingChecklistItemLogsDefect(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	phone := firstDriverPhone(st)
	HandleInbound(st, phone, "START", "")

	turn := HandleInbound(st, phone, "FAIL", "")
	foundDefect := false
	for _, e := range turn.Events {
		if e.Type == "checklist_item" && e.Result == "fail" && e.Key == "tyres" {
			foundDefect = true
		}
	}
	if !foundDefect {
		t.Errorf("expected a failing tyres item, got %+v", turn.Events)
	}
	if !strings.Contains(strings.ToLower(strings.Join(turn.Replies, " ")), "defect") {
		t.Errorf("a failed item should mention the defect, got %v", turn.Replies)
	}
}

func TestOdometerParsing(t *testing.T) {
	cases := []struct {
		in    string
		want  int64
		valid bool
	}{
		{"ODO 154320", 154320, true},
		{"odometer: 88,430", 88430, true},
		{"154320", 154320, true},
		{"KM 12000", 12000, true},
		{"1", 0, false},      // too small without a keyword
		{"2024", 0, false},   // looks like a year
		{"hello", 0, false},  // not a number
		{"ODO abc", 0, false},
	}
	for _, tc := range cases {
		got, ok := ParseOdometer(tc.in)
		if ok != tc.valid {
			t.Errorf("ParseOdometer(%q): validity %v want %v", tc.in, ok, tc.valid)
			continue
		}
		if tc.valid && got != tc.want {
			t.Errorf("ParseOdometer(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestOdometerMessageEmitsEvent(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	phone := firstDriverPhone(st)

	turn := HandleInbound(st, phone, "ODO 154320", "")
	found := false
	for _, e := range turn.Events {
		if e.Type == "odometer" && e.Km != nil && *e.Km == 154320 {
			found = true
		}
	}
	if !found {
		t.Errorf("expected an odometer event, got %+v", turn.Events)
	}
}

func TestConversationIsLoggedBothWays(t *testing.T) {
	st := store.New(time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC))
	phone := firstDriverPhone(st)
	HandleInbound(st, phone, "START", "")

	messages := st.MessagesFor(store.NormalisePhone(phone))
	if len(messages) < 2 {
		t.Fatalf("expected inbound and outbound to be logged, got %d", len(messages))
	}
	var inbound, outbound bool
	for _, m := range messages {
		if m.Direction == "inbound" {
			inbound = true
		}
		if m.Direction == "outbound" {
			outbound = true
		}
	}
	if !inbound || !outbound {
		t.Errorf("expected both directions logged: inbound=%v outbound=%v", inbound, outbound)
	}
}
