/**
 * A followup item is a durable server-side state container; its events are a
 * separate collection.  In particular, an empty event list must never be used
 * as evidence that the followup item does not exist.
 */
const eventBody = (event) => ({
  eventType: "followup",
  content: event.solution.trim() || null,
  occurredAt: `${event.time || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
});

const comparableEvent = (event) => ({
  time: event.occurredAt.slice(0, 10),
  solution: event.content ?? "",
});

/**
 * Produces only explicit mutations. `deleteFollowup` is intentionally absent:
 * this form has no whole-followup deletion action.
 */
export function planFollowupSave(existingFollowup, formEvents, resolved) {
  const desiredEvents = formEvents.filter((event) => event.time.trim() || event.solution.trim());
  const nextStatus = resolved ? "closed" : "pending";
  const plan = {
    createFollowup: null,
    patchFollowup: null,
    deleteFollowup: [],
    createEvents: [],
    patchEvents: [],
    deleteEvents: [],
  };

  if (!existingFollowup) {
    if (desiredEvents.length) {
      plan.createFollowup = { followStatus: nextStatus, event: eventBody(desiredEvents[0]) };
      plan.createEvents = desiredEvents.slice(1).map(eventBody);
    }
    return plan;
  }

  if (existingFollowup.followStatus !== nextStatus) plan.patchFollowup = { followStatus: nextStatus };
  const existingById = new Map(existingFollowup.events.map((event) => [event.id, event]));
  const desiredExistingIds = new Set();
  for (const event of desiredEvents) {
    if (!event.id) {
      plan.createEvents.push(eventBody(event));
      continue;
    }
    const existing = existingById.get(event.id);
    if (!existing) throw new Error(`Unknown followup event id: ${event.id}`);
    desiredExistingIds.add(event.id);
    const before = comparableEvent(existing);
    if (before.time !== event.time || before.solution !== event.solution) {
      plan.patchEvents.push({ id: event.id, body: eventBody(event) });
    }
  }
  for (const event of existingFollowup.events) {
    if (!desiredExistingIds.has(event.id)) plan.deleteEvents.push(event.id);
  }
  return plan;
}
