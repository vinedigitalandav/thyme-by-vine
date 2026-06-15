# Thyme by Vine — Project Spec

> A lightweight, multi-resource scheduling app that lets owners define availability and lets bookers reserve time slots across one or more "calendars" (users, courts, rooms, etc.)

---

## Design

All visual design decisions — colors, typography, spacing, component style, and aesthetic direction — are defined in `DESIGN.md`. This spec covers functionality and structure only. Any implementation must reference `DESIGN.md` for how the interface should look and feel.

---

## Hosting & Infrastructure

- **Platform**: Cloudflare Pages (frontend) and Cloudflare Workers (server-side logic and API routes)
- **Database**: Cloudflare D1, which is a serverless SQLite-compatible database
- **Authentication**: Session-based auth handled via Cloudflare Workers, using secure cookies to maintain owner sessions
- **Email**: A transactional email provider such as Resend, called from a Cloudflare Worker, for sending booking confirmations and cancellation notices
- **Environment variables**: All secrets (OAuth credentials, email API keys, etc.) are managed through the Cloudflare dashboard and injected at runtime

---

## Roles

### Owner
An authenticated user who sets up and manages the scheduling system. The owner creates resources, defines their availability, and shares a public booking link with bookers. The owner can also connect their Google Calendar so that bookings are automatically synced.

### Booker
An unauthenticated visitor who accesses the owner's public booking page. The booker selects a duration, chooses one or more resources, picks an available time slot, and provides their name and email to confirm a reservation. Bookers do not need an account.

---

## Core Concepts

### Resource
A resource is a bookable entity — the thing being reserved. Examples include a person such as a coach or staff member, a court such as Court 1 or Court 2 at a pickleball facility, or a room such as a meeting space. Each resource is managed independently and has its own availability schedule and booking history.

### Availability
The owner defines when each resource can be booked. This includes which days of the week the resource is available, what the operating hours are on those days, and which slot durations are offered (for example, 30 minutes, 1 hour, or 2 hours). The owner can also create date-specific overrides to block a day entirely or apply custom hours on a particular date.

### Slot
A slot is a computed time block derived from a resource's availability settings and a selected duration. A slot can be in one of three states: open (available to book), booked (already reserved), or held (temporarily locked while a booker is completing their reservation).

### Booking
A confirmed reservation made by a booker. It is linked to one or more resources, covers a specific start and end time, and records the booker's name and email. If a selected duration spans multiple consecutive slot blocks, those blocks are combined into a single booking.

---

## Features

### Owner: Dashboard

**Resource Management**
The owner can create, edit, and delete resources. Each resource has a name and an optional short description. Resources can be toggled active or inactive. Inactive resources do not appear on the public booking page.

**Availability Configuration**
For each resource, the owner defines a recurring weekly schedule by choosing which days are available and setting the operating hours for those days. The owner also selects which slot durations are offered for that resource. Date-specific overrides allow the owner to block a day off completely or set custom hours for a particular date, which takes precedence over the recurring schedule.

**Booking Inbox**
The owner can view all upcoming and past bookings across all resources in a single view. Bookings can be filtered by resource or date range. The owner can cancel any booking, which sends a cancellation email to the booker and removes the event from Google Calendar if synced. Bookings can be exported as a CSV file.

**Google Calendar Sync**
The owner connects their Google account from the settings page using Google's standard OAuth authorization flow. Once connected, every confirmed booking is automatically created as an event in the owner's Google Calendar, including the resource name, booker name, and booking time. If a booking is cancelled, the corresponding calendar event is deleted. The owner can disconnect the integration at any time. If the owner manages multiple Google Calendars, each resource can optionally be mapped to a specific calendar.

**Public Booking Link**
Each owner has a unique public URL based on a slug they set during onboarding. This is the link they share with bookers. For example, a pickleball facility might use a slug like "houston-pickle-club," making their booking page accessible at a URL like the app's domain followed by that slug.

---

### Booker: Public Booking Page

The booking experience is a linear, step-by-step flow intended to be completed in under three interactions.

**Step 1 — Select Duration**
The booker chooses how long they need. Only durations the owner has enabled are shown as options. Selecting a duration updates the rest of the page to reflect only compatible availability.

**Step 2 — Select Resource(s)**
The booker sees all active resources listed as selectable options. They may choose one or more resources to book at the same time. When multiple resources are selected, the system only shows time slots where all selected resources are simultaneously available. This ensures that no partial booking occurs where only some resources are free.

**Step 3 — Select a Time Slot**
A calendar view displays available time slots based on the chosen duration and selected resources. Slots are shown as time blocks on a weekly grid. Booked slots are visually distinct and cannot be clicked. When the booker selects an available slot, it is temporarily held for five minutes while they complete their information. A visible countdown communicates how long the hold lasts.

**Step 4 — Enter Info and Confirm**
The booker enters their name, email address, and an optional note. A booking summary is displayed showing the resource(s), date, start time, end time, and total duration. The booker submits to finalize.

**Confirmation**
A confirmation screen shows the full booking details. A confirmation email is sent to the booker's provided address.

---

## Data Structure

The following describes the data the application needs to store and how the pieces relate to each other. This is a logical description, not tied to any specific database technology.

**Owners**
Each owner record stores a unique identifier, their name, their email address, a securely hashed password, a public-facing slug used in their booking URL, and a timestamp of when the account was created.

**Google Calendar Connections**
Each owner may have one connected Google account. This record stores the OAuth access token, the refresh token, the Google account's email address, an optional default Google Calendar ID, and an optional mapping of resource identifiers to specific Google Calendar IDs for owners who use separate calendars per resource.

**Resources**
Each resource belongs to an owner and stores a unique identifier, a name, an optional description, an active or inactive status flag, and a created timestamp.

**Availability Rules**
Each availability rule belongs to a resource and defines its recurring weekly schedule. It stores the day of the week, a start time, an end time, and a list of slot durations in minutes that are offered on that day.

**Availability Overrides**
Each override belongs to a resource and applies to a specific calendar date. It stores whether the day is fully blocked or whether it has custom hours, and if custom, the start and end times for that date.

**Bookings**
Each booking stores a unique identifier, a reference to the owner it belongs to, the booker's name, the booker's email, an optional note from the booker, the start and end timestamps, the duration in minutes, a status of either confirmed or cancelled, a created timestamp, and optionally the Google Calendar event ID so the event can be deleted if the booking is cancelled.

**Booking-Resource Associations**
Each booking can be linked to one or more resources. This is stored as a simple list of associations between a booking and a resource, allowing multi-resource bookings to be recorded accurately.

**Slot Holds**
When a booker selects a time slot, a temporary hold is created. It records which resources and what time window are being held, an expiration timestamp five minutes from creation, and a session token to match the hold back to the booker when they confirm. The system automatically releases holds that have expired.

---

## Page Structure

**Public-facing pages**
- A public booking page for a specific owner, accessed via their slug
- A booking confirmation page shown after a successful submission

**Owner-facing pages (require login)**
- A login page for returning owners
- An onboarding flow for new owners to set up their name and slug
- A dashboard home page showing a summary of upcoming bookings
- A resource management page for creating, editing, and deactivating resources
- An availability configuration page for each resource
- A bookings inbox with filtering by resource or date and an option to export
- A settings page for managing account details and the Google Calendar integration

---

## Google Calendar Integration Details

The owner initiates the Google Calendar connection from their settings page. They are redirected to Google's authorization screen, grant the app permission to manage their calendar events, and are returned to their dashboard upon success. The app stores the resulting access and refresh tokens securely.

When a booking is confirmed, the app creates a Google Calendar event with the following details: the names of the booked resource(s) as the event title, the booker's name and email in the event description, and the booking's start and end times. The Google Calendar event ID is saved to the booking record.

When a booking is cancelled, the app uses the stored event ID to delete the corresponding Google Calendar event.

When the access token expires, the app uses the stored refresh token to obtain a new one automatically, without requiring the owner to reconnect.

---

## Email Notifications

When a booking is confirmed, the booker receives an email listing the booked resource(s), the date and time, the duration, and a note directing them to contact the owner if they need to make changes. The owner's email is used as the reply-to address on all emails sent to bookers.

When a booking is cancelled by the owner, the booker receives an email notifying them that the booking has been cancelled.

---

## Out of Scope for Version 1

- Payment collection or deposit handling
- SMS notifications
- Outlook or Apple Calendar sync
- Recurring or repeating bookings
- Waitlists
- Booker accounts or login
- Multiple owners sharing a single organization or account

---

## Success Criteria

- An owner can create resources, configure availability, and share a booking link in under five minutes
- A booker can complete a booking in under three steps after landing on the public page
- Multi-resource bookings correctly prevent double-booking across all selected resources
- Confirmed bookings appear in the owner's Google Calendar automatically, and cancellations remove them
- The full experience works on mobile without any degradation in functionality