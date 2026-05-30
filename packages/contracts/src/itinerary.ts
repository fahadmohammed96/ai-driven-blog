import { z } from "zod";

/**
 * Itinerary — the travel vertical's content type (PRODUCT glossary): an ordered
 * list of stops, each with a place, optional geo, a date span and notes. It is
 * the canonical structured fuel that articles and trips are built from.
 */

/** Calendar date, YYYY-MM-DD (no time/zone — itineraries are day-grained). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const itineraryStopSchema = z
  .object({
    place: z.string().min(1),
    geo: geoPointSchema.optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    notes: z.string().optional(),
  })
  .refine((s) => s.startDate <= s.endDate, {
    message: "startDate must be on or before endDate",
    path: ["endDate"],
  });
export type ItineraryStop = z.infer<typeof itineraryStopSchema>;

export const itinerarySchema = z.object({
  title: z.string().min(1),
  stops: z.array(itineraryStopSchema).min(1),
});
export type Itinerary = z.infer<typeof itinerarySchema>;
