import { PageHeader, SurfacePlaceholder } from "../../../src/ui/components";

export default function ProposalsSurface() {
  return (
    <div data-testid="surface-proposals">
      <PageHeader
        title="Proposal Queue"
        subtitle="Il gesto propose→approve: le proposte degli specialisti AI che approvi, modifichi o rifiuti."
      />
      <SurfacePlaceholder slice={3}>
        Qui vivrà la coda di proposte (contenuti + distribuzione), riusando la macchina a stati e il
        gate di approvazione della Fase 2.5.
      </SurfacePlaceholder>
    </div>
  );
}
