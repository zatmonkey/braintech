package main

import "testing"

func TestTrackerDenylist(t *testing.T) {
	blocked := []string{"tr.snapchat.com", "tr6.snapchat.com", "analytics.tiktok.com", "sub.tr.snapchat.com", "TR.SNAPCHAT.COM."}
	allowed := []string{"www.snapchat.com", "sc-cdn.net", "app.snapchat.com", "www.tiktok.com", "v16-webapp-prime.us.tiktok.com", "youtube.com", "www.youtube.com"}
	for _, d := range blocked {
		if !isTrackerDomain(d) {
			t.Errorf("expected tracker: %s", d)
		}
		if app := classifyApp(d); app != "" {
			t.Errorf("tracker classified as %q: %s", app, d)
		}
	}
	for _, d := range allowed {
		if isTrackerDomain(d) {
			t.Errorf("false positive tracker: %s", d)
		}
		if app := classifyApp(d); app == "" {
			t.Errorf("real app host not classified: %s", d)
		}
	}
	if classifyApp("t.co") != "" || classifyApp("foo.t.co") != "" {
		t.Error("t.co should no longer classify as X")
	}
}
