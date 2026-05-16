# Code of Conduct — Enforcement Runbook

**Audience:** Project maintainers only.
**Purpose:** Consistent, fair, private handling of CoC violation reports.

---

## Receiving a Report

All reports arrive via the private security contact (`SECURITY.md`) or direct message to a maintainer.

1. Acknowledge receipt within **48 hours** using the template below.
2. Do not share the complainant's identity without explicit written consent.
3. Do not discuss the report publicly until resolution is complete.

**Acknowledgement template:**

> Thank you for bringing this to our attention. We take this report seriously.
> We will review it and respond within 5 business days.
> Your identity will remain confidential.

---

## Triage

Assess severity on receipt:

| Severity | Examples                                                                |
| -------- | ----------------------------------------------------------------------- |
| Critical | Threats, doxxing, targeted harassment, explicit discriminatory language |
| High     | Sustained hostile behavior, repeated boundary violations                |
| Medium   | Single incident of disrespectful language or unwanted contact           |
| Low      | Tone disagreement, misunderstanding without escalation                  |

For **Critical** severity: escalate same day; suspend the actor from repo interactions via GitHub organization settings while investigating.

---

## Investigation

1. Collect evidence: issue links, PR comments, DM screenshots (shared voluntarily), witness accounts.
2. Assume good faith in ambiguous cases until evidence points otherwise.
3. Do not contact the accused before gathering initial evidence.
4. Review against [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) §Unacceptable Behavior.

---

## Response Actions

Select the proportionate action:

| Action        | When to use                                            |
| ------------- | ------------------------------------------------------ |
| No action     | Report unfounded after investigation                   |
| Correction    | First violation, low severity, good faith error        |
| Warning       | Pattern of low–medium severity or second low violation |
| Temporary ban | High severity or repeated warnings                     |
| Permanent ban | Critical severity or violation after temp ban          |

---

## Response Templates

### Correction

> We reviewed the report and found the behavior was inconsistent with our Code of Conduct.
> We have sent a private message asking for a correction. No further action at this time.

### Warning

> Following a review, we are issuing a formal warning.
> A repeat of this behavior will result in a temporary ban from project spaces.

### Temporary ban (N days)

> After careful review, we are temporarily restricting your access to project spaces for N days.
> During this period you may not open issues, submit PRs, or participate in Discussions.
> This decision was made by [N] maintainers and may be appealed by replying to this message.

### Permanent ban

> After careful review, we have permanently removed your access to project spaces.
> This decision was made unanimously by the maintainer team.

---

## Notification

- Notify the complainant of the outcome (no details of the specific action unless they ask).
- Notify the accused of the action taken via private message.
- Do **not** post public announcements unless the incident itself became public and a statement is needed for community clarity.

---

## Escalation

If maintainers disagree on the appropriate action:

1. Each maintainer documents their position privately.
2. Majority vote determines outcome for medium/high severity.
3. Unanimous agreement required for permanent ban.
4. If no consensus in 72 hours, default to the more conservative (lesser) action and revisit in 30 days.

---

## Record Keeping

Keep a private log (maintainer-only) with:

- Date of report
- Severity classification
- Action taken
- Date of resolution
- Whether the actor had prior incidents

Logs are never shared publicly and are retained for 2 years, then deleted.

---

## Appeals

Any actor receiving a warning or ban may appeal by replying to the maintainer notification within 14 days. Appeals are reviewed by a maintainer who was not involved in the original decision.
