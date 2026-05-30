// Public surface of the tenancy module. Other modules import ONLY from here.
export { TenancyModule } from "./tenancy.module";
export { TenancyService, DEFAULT_TENANT_ID, type TenantContext } from "./tenancy.service";
