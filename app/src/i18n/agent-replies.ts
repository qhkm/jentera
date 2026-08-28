/* ============================================================
   English agent replies.

   lib/data/conversations.ts is a verbatim port and is Malay only,
   so a tagged agent answered in BM even with the UI in English.
   These are the EN counterparts, kept here for the same reason
   pages.ts exists: the generated file stays regenerable.

   Two deliberate differences from the BM source:

   · business-neutral. The BM originals name wagyu and udon, but
     these replies are shown for all twenty playbooks — a salon
     owner should not be told about their noodle stock.
   · no emoji, matching the rest of the product. This is Jentera
     speaking, not a customer typing.
   ============================================================ */

export const TEAM_REPLIES_EN: Record<string, string[]> = {
  'Customer Assistant': [
    'On it. Two customers asked about opening hours and both are answered. Latest details went out to three chats.',
    "Handled. One customer asked for a discount, so I've put it in Activity for your approval.",
    'Done. Every enquiry from this morning has been answered, nothing left outstanding.',
  ],
  'Booking Agent': [
    'Checked — four new bookings today, all confirmed. One asked for a different time and I offered Friday.',
    "Today's schedule is set: seven bookings confirmed, reminders sent.",
    "One no-show risk. The automatic reminder has gone out; if there's no reply I'll escalate it to you.",
  ],
  'Follow-up': [
    "This week's promotion is scheduled — 23 customers receive it tomorrow at 10am.",
    'Loyalty reminders went to 15 regulars. Five have replied and three booked again.',
    "Last week's feedback: eight positive, two suggestions. Both are summarised in your weekly report.",
  ],
  'Ops Assistant': [
    'Weekly report is ready. Sales are up 12% on last week, with your top items listed.',
    'Stock on your fastest-moving item is down to about three days. I can reorder tomorrow — want me to?',
    'Tracked everything: 87 transactions today, busiest between 7 and 9pm. Operations normal.',
  ],
};

export const TEAM_GENERAL_EN: string[] = [
  "Heard. I'm ready to help inside your private workspace.",
  'Noted. I can help you research, plan, write, and organise the work here.',
  "Sure. Tell me the outcome you need and I'll help you move it forward.",
];
