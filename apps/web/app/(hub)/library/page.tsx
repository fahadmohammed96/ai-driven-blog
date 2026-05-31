import { PageHeader, SurfacePlaceholder } from "../../../src/ui/components";

export default function LibrarySurface() {
  return (
    <div data-testid="surface-library">
      <PageHeader
        title="Library"
        subtitle="Tutti i contenuti (article, page, gallery, itinerary…), filtrabili, con il badge di stato."
      />
      <SurfacePlaceholder slice={1}>
        Qui vivranno tutti i ContentItem con filtri e badge di stato dalla macchina a stati di
        pubblicazione.
      </SurfacePlaceholder>
    </div>
  );
}
