import { PageHeader, SurfacePlaceholder } from "../../../src/ui/components";

export default function SettingsSurface() {
  return (
    <div data-testid="surface-settings">
      <PageHeader
        title="Settings"
        subtitle="Brand voice, autonomia per specialista (manuale / semi-auto / auto entro limiti), canali."
      />
      <SurfacePlaceholder slice={4}>
        Qui vivranno brand voice, lo stub del knob di autonomia per specialista (default
        <strong> manuale</strong>) e la gestione dei canali.
      </SurfacePlaceholder>
    </div>
  );
}
