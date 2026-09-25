/* Business apps, as the Worker serves them (worker/src/routes/apps.ts).
   Remote only: LocalRepository has no `apps`, so the anonymous demo never
   shows any of this. */

export type AppKey = 'bookings';

export interface InstalledApp {
  key: AppKey;
  /** An operator's pause; the owner cannot change it. */
  state: 'active' | 'paused';
  /** The owner's own Taking bookings switch. A Worker that predates it is read as true. */
  accepting: boolean;
  publicUrl: string;
  /** Pending requests whose time has not started. */
  pending: number;
}

export interface AppsList {
  apps: InstalledApp[];
  available: AppKey[];
}

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';
export type CalendarStatus = 'none' | 'pending' | 'created' | 'failed' | 'not_connected' | 'removed';
export type CalendarReason = 'reconnect' | 'disconnected' | 'removed_in_google' | 'unconfirmed' | 'provider';

export interface Booking {
  id: string;
  reference: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  customerName: string;
  customerPhone: string;
  note: string | null;
  status: BookingStatus;
  /** Pending, but its start has passed: it can no longer be confirmed. */
  expired: boolean;
  decidedAt: string | null;
  cancelledAt: string | null;
  calendar: {
    status: CalendarStatus;
    error: string | null;
    reason: CalendarReason | null;
    canRetry: boolean;
    /** The Google account's email, kept across a disconnect. */
    account: string | null;
  };
  /** A prefilled message the owner opens; never proof that anything was sent. */
  whatsappUrl: string | null;
  createdAt: string;
}

export interface BookingsPage {
  bookings: Booking[];
  nextCursor: string | null;
}

export interface BookingsQuery {
  /** A Malaysian date, YYYY-MM-DD. */
  from: string;
  /** 1–31 Malaysian days. */
  days: number;
  status?: 'pending';
  cursor?: string;
}

export interface BookingActionResult {
  booking: Booking;
  whatsappUrl: string | null;
  calendarQueued: boolean;
}

export interface WeeklyHours {
  /** 0 = Sunday. */
  weekday: number;
  opens: string;
  closes: string;
}

export interface BookingService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  capacity: number;
  priceLabel: string | null;
  active: boolean;
  hours: WeeklyHours[];
}

export interface BookingsConfig {
  installation: { slug: string; state: 'active' | 'paused'; publicUrl: string } | null;
  version: number | null;
  settings: { accepting: boolean; minNoticeMinutes: number; horizonDays: number; location: string | null; availabilityAcknowledgedAt: string } | null;
  services: BookingService[];
}

export interface BookingServiceInput extends Omit<BookingService, 'id'> {
  /** null for a service not saved yet. */
  id: string | null;
}

export interface BookingsConfigInput {
  version: number | null;
  slug: string;
  accepting: boolean;
  minNoticeMinutes: number;
  horizonDays: number;
  location: string | null;
  acknowledgeAvailabilityLimits: boolean;
  services: BookingServiceInput[];
}

export interface AppsApi {
  list(): Promise<AppsList>;
  bookingsConfig(): Promise<BookingsConfig>;
  saveBookingsConfig(input: BookingsConfigInput): Promise<BookingsConfig>;
  bookings(query: BookingsQuery): Promise<BookingsPage>;
  booking(id: string): Promise<Booking>;
  decide(id: string, decision: 'confirm' | 'decline'): Promise<BookingActionResult>;
  cancel(id: string): Promise<BookingActionResult>;
  retryCalendar(id: string): Promise<BookingActionResult>;
}
