# Stage 6: Connected volunteer and coordinator journeys

## Research and acceptance

The stage joins opportunity creation, scheduling, eligibility, staffing, attendance, service-hour review, and reporting through actual records. Volunteer management workflow guidance from [Volunteero](https://volunteero.org/knowledge-center/10-key-features-to-look-for-in-volunteer-management-software) emphasizes recruitment, role requirements, qualifications, check-in, and hours. [Workflow-heavy software testing guidance](https://edilec.com/blog/dev-9009/testing-strategy-for-workflow-heavy-software/) emphasizes transition guards, repeated commands, rejected transitions, and reconciled records. These are practitioner sources, not independent validation of CivicFlow.

The sample is isolated and intentionally uses a fixed clock. Its browser solver is not the native Rust optimizer. The hosted PWA queues requests locally and does not imply acceptance until the server confirms them. Production migration, real staging users, actual external notification delivery, and independent user testing remain separate acceptance activities.

## Evidence

- Runtime-created opportunities and shift series participate in the same schedule, roster and reporting models.
- Registration validates seat capacity, role and credentials; duplicate registrations and repeat cancellation cannot double-count seats.
- Attendance must precede checkout, which produces one pending service record; report approval is a distinct action.
- Waitlist promotion is validated against the released seat; recipient-specific sample notifications reflect state changes.
- The PWA distinguishes queued requests from confirmed server outcomes and blocks closed or canceled shift registration.
- Journey tests run in the full frontend suite, alongside existing native lifecycle, waitlist, notification, reporting, and simulated reconnect/convergence tests.

The final acceptance requires green full CI, fresh screenshots, and verification of the actual journey. The test fixture is not proof of a real nonprofit pilot.

The compiled-browser journey additionally exercises a rejected code, successful attendance, checkout, persisted pending service, coordinator approval, and volunteer history after a fixture identity change. Screenshot evidence is uploaded by full CI. No test seeds a successful attendance or approval record.

The first complete unit suite passed 511 of 514 tests. Three previous solver fingerprints changed because future-issued credentials in the seed were incorrectly considered current. The replacement hashes are the observed outputs from that run; explicit eligibility tests reject the future-dated driver credential, and the original count and score assertions remain. The sample welcome now supports switching between its two fixed demo identities without editing storage or touching a hosted account.

The open-seat application uses the existing waitlist/review queue without promising a seat. The preview prioritizes explicitly requested, eligible applicants only when Include waitlist is enabled; every hard constraint still runs first. The linked shift check-in route uses the actual shift ID, not the seeded pantry event. Browser acceptance now also exercises creation and staffing of a new opportunity.

Coordinator attendance and promotion screens now announce completion only after the repository accepts the write. Repeated submissions are blocked while the operation is pending. Roster links carry the actual event ID into the kiosk and attendance board, preserving the selected event.
