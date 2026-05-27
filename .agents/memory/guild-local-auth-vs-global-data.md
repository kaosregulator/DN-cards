# Guild-local auth versus global data

In Discord or multi-tenant community apps, guild-scoped admin checks are unsafe when the underlying tables are global. Before reusing a per-guild admin guard, confirm the mutated records are also tenant-scoped; otherwise any guild owner/admin can tamper with shared state for every other tenant.