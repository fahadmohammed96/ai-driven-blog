import { PageHeader, SurfacePlaceholder } from "../../../src/ui/components";

export default function EditorSurface() {
  return (
    <div data-testid="surface-editor">
      <PageHeader
        title="Block Editor"
        subtitle="Modifica un contenuto sul modello a blocchi canonico (JSON portabile, non HTML)."
      />
      <SurfacePlaceholder slice={2}>
        Qui vivrà l&apos;editor a blocchi canonici con il misuratore di autenticità (E-E-A-T).
      </SurfacePlaceholder>
    </div>
  );
}
