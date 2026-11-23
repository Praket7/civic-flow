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
