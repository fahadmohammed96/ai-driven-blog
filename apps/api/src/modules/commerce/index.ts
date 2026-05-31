// Public surface of the commerce module.
export { CommerceModule } from "./commerce.module";
export type { PaymentPort, DepositRequest, DepositResult } from "./payment.port";
export { StubPaymentClient, createPaymentFromEnv } from "./payment.stub";
export {
  nextBookingStatus,
  InvalidBookingTransitionError,
  ACTIVE_BOOKING_STATUSES,
  type BookingEvent,
} from "./booking-state";
export {
  insertTrip,
  getTrip,
  listTrips,
  insertDeparture,
  getDeparture,
  getDepartureForUpdate,
  listDeparturesForTrips,
  usageForDepartures,
  countActiveBookings,
  insertBooking,
  getBooking,
  updateBooking,
  type TripRow,
  type DepartureRow,
  type BookingRow,
  type NewTrip,
  type NewDeparture,
  type NewBooking,
  type DepartureUsage,
} from "./commerce.repo";
export {
  bookSeat,
  payDeposit,
  DepartureNotFoundError,
  BookingNotFoundError,
  DepositFailedError,
  type CommerceDeps,
  type BookSeatInput,
} from "./commerce.service";
