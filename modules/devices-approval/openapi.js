'use strict';

/**
 * The OpenAPI parts of a new device's approval (devices-approval/): the device's own `approval` as GET /devices/me
 * and pairing return it, the two routes a person's device decides with, and the two events a waiting device hears.
 * openapi.js is at its size limit, so they are written here and spread into it.
 */
function approvalSchema({ obj, str, arr }) {
  return obj({
    state: str({ enum: ['pending', 'approved', 'refused'] }),
    askedAt: str({ format: 'date-time', description: 'While pending: since when it waits.' }),
    askedOf: arr(str(), { description: 'While pending: the names of whoever was asked — the device\'s own person when they may approve their own, and anyone who approves any device.' }),
    message: str({ description: 'While pending: "Waiting for approval by …", to show as it is.' }),
    at: str({ format: 'date-time' }), by: str({ description: 'Who decided, by name.' }),
    dropped: arr(str(), { description: 'Scopes the approver did not hold, so the device does not either.' }),
  }, { description: 'Whether this device may act yet. `pending`: it may read GET /devices/me and hold GET /events, nothing else — every other route answers 403 pending_approval. See PROTOCOL.md §5.1.' });
}

function paths({ obj, str, arr, json, std }) {
  const deviceId = { name: 'id', in: 'path', required: true, description: 'The waiting device.', schema: str() };
  const decide = (verb, summary, what) => ({ parameters: [deviceId], post: { tags: ['Devices'], summary, operationId: `${verb}Device`, 'x-scope': 'interact',
    description: `As this device's person: ${what}. Allowed when their level approves the device (its approveDevices: their own, or anyone's). A device is usually asked as a prompt instead (choices allow, refuse); this is the direct way. 409 once it was decided.`,
    responses: { 200: json(obj({ device: obj({}, { additionalProperties: true }) })), ...std(401, 403, 404, 409) } } });
  return {
    '/devices/{id}/approve': decide('approve', 'Allow a new device that waits for approval', 'allow it, holding at most what you hold'),
    '/devices/{id}/refuse': decide('refuse', 'Refuse a new device that waits for approval', 'refuse it; its token is revoked'),
  };
}

/** The events' payloads, for openapi.js `P` (a waiting device hears only these, revoked and resync). */
function events({ obj, str, arr }) {
  return {
    'device.approved': { audience: 'device', payload: obj({ by: str(), at: str({ format: 'date-time' }), scopes: arr(str()), dropped: arr(str()) }),
      note: 'This device was allowed: every route opens now. `dropped` are scopes the approver did not hold; refetch /capabilities.' },
    'device.refused': { audience: 'device', payload: obj({ by: str(), at: str({ format: 'date-time' }) }),
      note: 'This device was refused: its token is revoked and the stream closes. Forget the token; pairing again starts over.' },
  };
}

module.exports = { approvalSchema, paths, events };
