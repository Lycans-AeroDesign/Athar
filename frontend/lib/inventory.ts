import type { ComponentCondition, InventoryType, StockStatus } from "@/lib/api/types";

// Option lists for the workshop-inventory fields on components, in the order
// the inventory sheet's own dropdowns list them.

export const INVENTORY_TYPE_VALUES: InventoryType[] = ["MECHANICAL", "ELECTRICAL"];

export const CONDITION_VALUES: ComponentCondition[] = ["NEW", "GOOD", "FAIR", "WORN", "NEEDS_REPAIR", "BROKEN"];

export const STOCK_STATUS_VALUES: StockStatus[] = ["IN_STOCK", "LOW_STOCK", "MISSING", "ON_ORDER", "RETIRED"];

/** The "Needs ordering" view - what the sheet's Summary tab totals as missing or on order. */
export const NEEDS_ORDERING_STATUSES: StockStatus[] = ["MISSING", "ON_ORDER"];

/** The sheet's own Units list - suggestions only, any text is allowed. */
export const UNIT_SUGGESTIONS = ["each", "pair", "set", "box", "ft", "in", "sheet", "lb", "roll", "bottle", "pack"];
