---
name: mobile-travel-app-eval
description: Evaluate mobile travel booking app pages with destination search, filters, booking flow, bottom navigation tabs, trips badge, profile/settings, and mobile viewport screenshots.
---

# Mobile Travel App Eval Skill

Use this skill for mobile travel/booking app tasks: destination search, filters, booking flow, bottom tabs, trips badge, and profile/settings screens.

Default browser method: Playwright isolated Chrome with a mobile-like viewport, typically `430x900`. Capture screenshots for the initial screen and each tab/screen transition.

## Strong Automated Checks

- Initial search/explore screen has destination cards, search input, filters, price/rating/sort controls.
- Bottom navigation has four tabs, usually 探索、预订、行程、我的.
- Clicking each tab changes visible content to the expected screen.
- Selecting a destination enters booking context.
- Date selection or booking controls are reachable.
- Confirming a booking adds a trip/order item or increments the trips badge.
- Profile/settings controls are visible and clickable if required.

## Booking Flow Strategy

1. Start at explore/search screen.
2. Capture screenshot.
3. Click the first destination card.
4. Capture booking screen.
5. Select dates using visible date labels or date buttons.
6. Confirm booking.
7. Capture result.
8. Open 行程 tab and assert order count/badge changed.

If the acceptance only asks for the four-screen shell, tab DOM/text checks plus screenshots are enough. If it asks for booking functionality, require a downstream trip/order state change.

## Reporting

Report each screen separately. A pass needs both navigation click success and content matching. For visual/mobile polish, include screenshots and make a model-judged verdict first; use `fail` only when the target visual state is not captured or cannot be judged.
