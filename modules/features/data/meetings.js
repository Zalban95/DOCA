'use strict';

/* People meeting people: calls between the hive's people, screens shared with consent, invites in their own calendars. */
module.exports = [
  { id: 'meetings', licence: 'meetings', name: 'Meetings: calls between people, in their own calendars', page: 'meetings', tools: ['meeting'], since: '3.15.0',
    use: 'Call a colleague now, or schedule a meeting that lands in each person\'s own calendar (Google, Microsoft, or an iCalendar invite) with its link.',
    routes: ['/api/meetings*', '/meet/*', '/ws/meet/*'], settings: ['meetings.maxPeople', 'meetings.remindMin', 'meetings.iceUrls'], tables: ['meetings', 'meeting_people'],
    words: 'meeting call video voice conference calendar invite schedule ics icalendar google microsoft outlook zoom teams room link join colleague' },
  { id: 'screen-share', licence: 'meetings', name: 'Share your screen in a meeting, and let someone take control', page: 'meetings', since: '3.15.0',
    use: 'Share a screen or window with the room; take control only when the sharer offers and confirms it, through the hive\'s own app on their machine.',
    words: 'screen share sharing present presentation remote control take control desktop mouse keyboard help support consent' },
];
