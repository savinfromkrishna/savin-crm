import type { Bot, CrmCompany, CrmDeal, ErpProduct, ErpSalesOrder } from "@savingroup/contracts";
import { LOW_STOCK_THRESHOLD } from "@savingroup/contracts";
import { Button, cn, Input, NativeSelect, NativeSelectOption, Textarea } from "@savingroup/ui-web";
import {
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileCheck2,
  Globe,
  PackageCheck,
  Plus,
  Ship,
  Sparkles,
  TrendingDown,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { CsvExportButton } from "./commercial";
import { KpiCard, KpiGrid, StatusBadge, useMoney } from "./records";

// --- Domain Types & Storage Keys ---------------------------------------------

export type RequisitionPurpose =
  | "sales_order_fulfillment"
  | "crm_deal_pre_sourcing"
  | "safety_stock_eoq"
  | "capex_production_batch";

export type MarketScope = "domestic" | "international" | "dual_source";

export type IncotermCode = "DAP" | "EXW" | "FOB" | "CIF" | "DDP" | "FCA";

export type RequisitionLine = {
  productId: string;
  sku: string;
  productName: string;
  currentStock: number;
  requiredQty: number;
  estimatedUnitCost: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  unitsPerCarton: number;
  cartonGrossWeightKg: number;
  hsCode: string;
};

export type PurchaseRequisition = {
  id: string;
  ref: string;
  title: string;
  purpose: RequisitionPurpose;
  purposeRef: string;
  purposeJustification: string;
  marketScope: MarketScope;
  urgency: "critical" | "high" | "standard";
  status: "draft" | "sourcing_rfq" | "po_awarded" | "fulfilled";
  targetDeliveryDate: string;
  requiredCertifications: string[];
  requestedByBotId: string | null;
  requestedByName: string;
  lines: RequisitionLine[];
  awardedVendorId?: string;
  awardedPoRef?: string;
  createdAt: string;
};

export type SourcingVendor = {
  id: string;
  code: string;
  name: string;
  market: "domestic" | "international";
  country: string;
  cityPort: string;
  transportMode: "road_ftl" | "road_ltl" | "ocean_fcl" | "air_cargo";
  defaultIncoterm: IncotermCode;
  currency: string;
  priceFactor: number;
  productionLeadDays: number;
  transitLeadDays: number;
  customsDutyPct: number;
  freightBaseCost: number;
  freightPerCbmCost: number;
  insurancePct: number;
  portClearanceFee: number;
  onTimeDeliveryPct: number;
  qualityScorePct: number;
  paymentTerms: string;
  certifications: string[];
};

export type PurchaseOrderRecord = {
  id: string;
  ref: string;
  prRef: string;
  purpose: RequisitionPurpose;
  purposeRef: string;
  vendorId: string;
  vendorName: string;
  market: "domestic" | "international";
  country: string;
  originPortOrHub: string;
  destinationWarehouse: string;
  transportMode: "road_ftl" | "road_ltl" | "ocean_fcl" | "air_cargo";
  incoterm: IncotermCode;
  paymentTerms: string;
  status: "po_issued" | "in_production" | "in_transit" | "customs_clearance" | "grn_received";
  lines: RequisitionLine[];
  merchandiseSubtotal: number;
  freightCost: number;
  insuranceCost: number;
  customsDutyCost: number;
  portHandlingCost: number;
  totalLandedCost: number;
  etaDate: string;
  loadPlanId?: string;
  actorBotId: string | null;
  createdAt: string;
};

export type EquipmentSpec = {
  id: string;
  code: string;
  name: string;
  category: "ocean_container" | "air_uld" | "domestic_truck";
  maxVolumeCbm: number;
  maxPayloadKg: number;
  maxPalletSlots: number;
  internalLengthM: number;
  internalWidthM: number;
  internalHeightM: number;
  baseCostEstimate: number;
  description: string;
};

export type LoadPlanRecord = {
  id: string;
  ref: string;
  poRef: string;
  vendorName: string;
  market: "domestic" | "international";
  equipmentCode: string;
  vehicleOrContainerNumber: string;
  sealOrEwayBill: string;
  origin: string;
  destination: string;
  incoterm: IncotermCode;
  milestoneStep: number;
  status: "planning" | "loaded_dispatched" | "in_transit" | "customs_dock" | "grn_completed";
  lines: RequisitionLine[];
  createdAt: string;
};

const STORAGE_KEYS = {
  requisitions: "savingroup.erp.procurement.requisitions.v1",
  vendors: "savingroup.erp.procurement.vendors.v1",
  orders: "savingroup.erp.procurement.pos.v1",
  loadPlans: "savingroup.erp.logistics.loadplans.v1",
};

// --- Industrial Equipment Fleet Catalog (Containers & Domestic Trucks) --------

export const EQUIPMENT_CATALOG: EquipmentSpec[] = [
  {
    id: "eq-20gp",
    code: "20GP",
    name: "20ft Dry Standard Container (20' GP)",
    category: "ocean_container",
    maxVolumeCbm: 33.2,
    maxPayloadKg: 28_200,
    maxPalletSlots: 10,
    internalLengthM: 5.89,
    internalWidthM: 2.35,
    internalHeightM: 2.39,
    baseCostEstimate: 1450,
    description: "Dense heavy cargo · International Ocean FCL (10 Standard / 11 Euro Pallets)",
  },
  {
    id: "eq-40gp",
    code: "40GP",
    name: "40ft Dry Standard Container (40' GP)",
    category: "ocean_container",
    maxVolumeCbm: 67.7,
    maxPayloadKg: 26_600,
    maxPalletSlots: 20,
    internalLengthM: 12.03,
    internalWidthM: 2.35,
    internalHeightM: 2.39,
    baseCostEstimate: 2350,
    description: "Standard volume international import/export FCL (20 Standard Pallets)",
  },
  {
    id: "eq-40hc",
    code: "40HC",
    name: "40ft High Cube Container (40' HC)",
    category: "ocean_container",
    maxVolumeCbm: 76.4,
    maxPayloadKg: 26_460,
    maxPalletSlots: 22,
    internalLengthM: 12.03,
    internalWidthM: 2.35,
    internalHeightM: 2.69,
    baseCostEstimate: 2550,
    description: "High-volume cubed cargo · Extra 30cm vertical stacking height (22 Pallets)",
  },
  {
    id: "eq-air-pmc",
    code: "AIR-PMC",
    name: "Air Cargo ULD Pallet (PMC / LD3)",
    category: "air_uld",
    maxVolumeCbm: 11.5,
    maxPayloadKg: 4_626,
    maxPalletSlots: 4,
    internalLengthM: 3.18,
    internalWidthM: 2.44,
    internalHeightM: 1.63,
    baseCostEstimate: 3100,
    description: "Express International Air Freight for critical stockouts & high-value SKUs",
  },
  {
    id: "eq-truck-32ft",
    code: "TRK-32FT",
    name: "32ft Multi-Axle Container Truck (FTL)",
    category: "domestic_truck",
    maxVolumeCbm: 51.0,
    maxPayloadKg: 15_000,
    maxPalletSlots: 16,
    internalLengthM: 9.75,
    internalWidthM: 2.44,
    internalHeightM: 2.15,
    baseCostEstimate: 680,
    description: "Long-haul Domestic Full Truckload (FTL) interstate highway container",
  },
  {
    id: "eq-truck-22ft",
    code: "TRK-22FT",
    name: "22ft 10-Wheeler Heavy Commercial Truck",
    category: "domestic_truck",
    maxVolumeCbm: 36.0,
    maxPayloadKg: 16_000,
    maxPalletSlots: 12,
    internalLengthM: 6.7,
    internalWidthM: 2.3,
    internalHeightM: 2.33,
    baseCostEstimate: 520,
    description: "Heavy industrial domestic payload · High axle capacity for metal/machinery",
  },
  {
    id: "eq-truck-14ft",
    code: "TRK-14FT",
    name: "14ft LCV Regional Express Truck",
    category: "domestic_truck",
    maxVolumeCbm: 15.5,
    maxPayloadKg: 4_000,
    maxPalletSlots: 6,
    internalLengthM: 4.26,
    internalWidthM: 1.95,
    internalHeightM: 1.86,
    baseCostEstimate: 240,
    description: "Fast regional hub-to-warehouse replenishment & industrial cluster pickup",
  },
  {
    id: "eq-truck-ltl",
    code: "DOM-LTL",
    name: "Domestic LTL / Palletized Milk-Run",
    category: "domestic_truck",
    maxVolumeCbm: 8.0,
    maxPayloadKg: 2_000,
    maxPalletSlots: 3,
    internalLengthM: 2.4,
    internalWidthM: 1.8,
    internalHeightM: 1.85,
    baseCostEstimate: 135,
    description: "Consolidated Less-Than-Truckload pallet slot booking for small batches",
  },
];

// --- Default Global & Domestic Approved Vendor Master ------------------------

const DEFAULT_VENDORS: SourcingVendor[] = [
  {
    id: "vnd-dom-pune",
    code: "VND-DOM-01",
    name: "Bharat Precision Forge & Systems",
    market: "domestic",
    country: "Domestic (Local Hub)",
    cityPort: "Pune Industrial Corridor",
    transportMode: "road_ftl",
    defaultIncoterm: "DAP",
    currency: "USD",
    priceFactor: 0.72,
    productionLeadDays: 3,
    transitLeadDays: 2,
    customsDutyPct: 0,
    freightBaseCost: 220,
    freightPerCbmCost: 14,
    insurancePct: 0.35,
    portClearanceFee: 0,
    onTimeDeliveryPct: 98.4,
    qualityScorePct: 99.1,
    paymentTerms: "Net 30 Domestic",
    certifications: ["ISO-9001", "BIS", "RoHS"],
  },
  {
    id: "vnd-dom-west",
    code: "VND-DOM-02",
    name: "Apex National Industrial Supply Co.",
    market: "domestic",
    country: "Domestic (Western Express)",
    cityPort: "Ahmedabad Logistics Park",
    transportMode: "road_ltl",
    defaultIncoterm: "EXW",
    currency: "USD",
    priceFactor: 0.69,
    productionLeadDays: 4,
    transitLeadDays: 3,
    customsDutyPct: 0,
    freightBaseCost: 165,
    freightPerCbmCost: 18,
    insurancePct: 0.4,
    portClearanceFee: 0,
    onTimeDeliveryPct: 95.8,
    qualityScorePct: 97.4,
    paymentTerms: "Net 15 / 2% Early Discount",
    certifications: ["ISO-9001", "ISO-14001"],
  },
  {
    id: "vnd-intl-sz",
    code: "VND-INTL-01",
    name: "Shenzhen Nanshan Opto-Electronics Mfg.",
    market: "international",
    country: "China (CN)",
    cityPort: "Port of Shenzhen (CNSZX)",
    transportMode: "ocean_fcl",
    defaultIncoterm: "FOB",
    currency: "USD",
    priceFactor: 0.48,
    productionLeadDays: 7,
    transitLeadDays: 14,
    customsDutyPct: 7.5,
    freightBaseCost: 980,
    freightPerCbmCost: 42,
    insurancePct: 0.85,
    portClearanceFee: 320,
    onTimeDeliveryPct: 94.2,
    qualityScorePct: 96.8,
    paymentTerms: "30% TT Deposit / 70% Against B/L",
    certifications: ["ISO-9001", "CE", "RoHS", "FCC"],
  },
  {
    id: "vnd-intl-de",
    code: "VND-INTL-02",
    name: "Rheinmetall Industrie-Technik GmbH",
    market: "international",
    country: "Germany (DE)",
    cityPort: "Port of Hamburg (DEHAM)",
    transportMode: "ocean_fcl",
    defaultIncoterm: "CIF",
    currency: "EUR",
    priceFactor: 0.61,
    productionLeadDays: 6,
    transitLeadDays: 16,
    customsDutyPct: 5.0,
    freightBaseCost: 1120,
    freightPerCbmCost: 48,
    insurancePct: 0.6,
    portClearanceFee: 290,
    onTimeDeliveryPct: 99.2,
    qualityScorePct: 99.7,
    paymentTerms: "Irrevocable LC 60 Days",
    certifications: ["ISO-9001", "CE", "TÜV", "RoHS", "ISO-27001"],
  },
  {
    id: "vnd-intl-tw",
    code: "VND-INTL-03",
    name: "Hsinchu Semiconductor & Precision Corp.",
    market: "international",
    country: "Taiwan (TW)",
    cityPort: "Taipei Taoyuan Air Cargo (TPE)",
    transportMode: "air_cargo",
    defaultIncoterm: "DDP",
    currency: "USD",
    priceFactor: 0.57,
    productionLeadDays: 3,
    transitLeadDays: 4,
    customsDutyPct: 3.5,
    freightBaseCost: 1450,
    freightPerCbmCost: 110,
    insurancePct: 0.5,
    portClearanceFee: 180,
    onTimeDeliveryPct: 98.9,
    qualityScorePct: 99.5,
    paymentTerms: "Net 30 Global Credit Line",
    certifications: ["ISO-9001", "CE", "RoHS", "UL"],
  },
];

// --- Helpers & Volumetric Math -----------------------------------------------

export const PURPOSE_META: Record<
  RequisitionPurpose,
  {
    label: string;
    shortLabel: string;
    badgeTone: "info" | "warning" | "success" | "neutral";
    description: string;
  }
> = {
  sales_order_fulfillment: {
    label: "Sales Order Backorder & Demand Fulfillment",
    shortLabel: "SO Fulfillment",
    badgeTone: "warning",
    description:
      "Triggered by confirmed or pending customer Sales Orders where required SKU quantities exceed warehouse stock.",
  },
  crm_deal_pre_sourcing: {
    label: "CRM Pipeline Deal Readiness Pre-Sourcing",
    shortLabel: "Pipeline Deal Prep",
    badgeTone: "info",
    description:
      "Triggered by late-stage CRM Deals (Proposal / Negotiation) to lock supplier capacity before closing.",
  },
  safety_stock_eoq: {
    label: "Safety Stock & EOQ Auto-Replenishment",
    shortLabel: "Safety Stock EOQ",
    badgeTone: "neutral",
    description:
      "Triggered when warehouse stock falls below safety threshold to restore Economic Order Quantity (EOQ).",
  },
  capex_production_batch: {
    label: "Strategic Production Run / New Market Launch",
    shortLabel: "Production / CapEx",
    badgeTone: "success",
    description:
      "Planned bulk procurement for manufacturing BOM runs, seasonal buffer, or new warehouse commissioning.",
  },
};

export function computeLineLogistics(line: RequisitionLine) {
  const unitsPerCarton = Math.max(1, line.unitsPerCarton || 1);
  const cartons = Math.ceil(line.requiredQty / unitsPerCarton);
  const singleCartonCbm =
    (Math.max(10, line.cartonLengthCm) *
      Math.max(10, line.cartonWidthCm) *
      Math.max(10, line.cartonHeightCm)) /
    1_000_000;
  const totalCbm = Number((cartons * singleCartonCbm).toFixed(3));
  const totalWeightKg = Number((cartons * Math.max(1, line.cartonGrossWeightKg)).toFixed(1));
  // Standard industrial pallet holds ~1.45 CBM or ~850 kg
  const palletsByVolume = totalCbm / 1.45;
  const palletsByWeight = totalWeightKg / 850;
  const estimatedPallets = Math.max(1, Math.ceil(Math.max(palletsByVolume, palletsByWeight)));
  return {
    cartons,
    singleCartonCbm,
    totalCbm,
    totalWeightKg,
    estimatedPallets,
  };
}

export function computeAggregateLogistics(lines: RequisitionLine[]) {
  let totalUnits = 0;
  let totalCartons = 0;
  let totalCbm = 0;
  let totalWeightKg = 0;
  let totalPallets = 0;

  for (const line of lines) {
    const metrics = computeLineLogistics(line);
    totalUnits += line.requiredQty;
    totalCartons += metrics.cartons;
    totalCbm += metrics.totalCbm;
    totalWeightKg += metrics.totalWeightKg;
    totalPallets += metrics.estimatedPallets;
  }

  return {
    totalUnits,
    totalCartons,
    totalCbm: Number(totalCbm.toFixed(2)),
    totalWeightKg: Number(totalWeightKg.toFixed(1)),
    totalPallets,
  };
}

export function recommendOptimalEquipment(
  lines: RequisitionLine[],
  market: "domestic" | "international",
): {
  primary: EquipmentSpec;
  unitsNeeded: number;
  volumeUtilizationPct: number;
  weightUtilizationPct: number;
  palletUtilizationPct: number;
  limitingFactor: "Volume (Cubed Out)" | "Weight (Weighed Out)" | "Pallet Deck Slots";
} {
  const agg = computeAggregateLogistics(lines);
  const candidates = EQUIPMENT_CATALOG.filter((eq) =>
    market === "domestic"
      ? eq.category === "domestic_truck"
      : eq.category === "ocean_container" || eq.category === "air_uld",
  );

  // Pick single unit that fits with highest efficiency (45%-92%), else largest unit * N
  const fitting = candidates.filter(
    (eq) =>
      agg.totalCbm <= eq.maxVolumeCbm * 0.95 &&
      agg.totalWeightKg <= eq.maxPayloadKg * 0.95 &&
      agg.totalPallets <= eq.maxPalletSlots,
  );

  const chosen =
    fitting.sort((a, b) => a.baseCostEstimate - b.baseCostEstimate)[0] ??
    candidates.find((c) => c.code === (market === "domestic" ? "TRK-32FT" : "40HC")) ??
    EQUIPMENT_CATALOG[0]!;

  const byVol = Math.ceil(agg.totalCbm / Math.max(0.1, chosen.maxVolumeCbm));
  const byWt = Math.ceil(agg.totalWeightKg / Math.max(1, chosen.maxPayloadKg));
  const byPal = Math.ceil(agg.totalPallets / Math.max(1, chosen.maxPalletSlots));
  const unitsNeeded = Math.max(1, byVol, byWt, byPal);

  const volumeUtilizationPct = Math.min(
    100,
    Math.round((agg.totalCbm / (chosen.maxVolumeCbm * unitsNeeded)) * 100),
  );
  const weightUtilizationPct = Math.min(
    100,
    Math.round((agg.totalWeightKg / (chosen.maxPayloadKg * unitsNeeded)) * 100),
  );
  const palletUtilizationPct = Math.min(
    100,
    Math.round((agg.totalPallets / (chosen.maxPalletSlots * unitsNeeded)) * 100),
  );

  const limitingFactor =
    weightUtilizationPct >= volumeUtilizationPct && weightUtilizationPct >= palletUtilizationPct
      ? "Weight (Weighed Out)"
      : palletUtilizationPct >= volumeUtilizationPct
        ? "Pallet Deck Slots"
        : "Volume (Cubed Out)";

  return {
    primary: chosen,
    unitsNeeded,
    volumeUtilizationPct,
    weightUtilizationPct,
    palletUtilizationPct,
    limitingFactor,
  };
}

export type VendorQuoteEvaluation = {
  vendor: SourcingVendor;
  merchandiseSubtotal: number;
  freightCost: number;
  insuranceCost: number;
  customsDutyCost: number;
  portHandlingCost: number;
  totalLandedCost: number;
  landedUnitCostAvg: number;
  totalLeadDays: number;
  aiCompositeScore: number;
  badge: "best_landed_cost" | "fastest_dock" | "lowest_risk" | null;
};

export function evaluateVendorsForRequisition(
  pr: PurchaseRequisition,
  vendors: SourcingVendor[],
  strategy: "lowest_landed_cost" | "fastest_delivery" | "balanced_ai",
): VendorQuoteEvaluation[] {
  const agg = computeAggregateLogistics(pr.lines);
  const filtered = vendors.filter((v) => {
    if (pr.marketScope === "domestic") return v.market === "domestic";
    if (pr.marketScope === "international") return v.market === "international";
    return true;
  });

  const activeVendors = filtered.length > 0 ? filtered : vendors;

  const rawEvals = activeVendors.map((vendor) => {
    const retailBaseline = pr.lines.reduce(
      (sum, line) => sum + line.requiredQty * Math.max(10, line.estimatedUnitCost),
      0,
    );
    const merchandiseSubtotal = Number((retailBaseline * vendor.priceFactor).toFixed(2));
    const freightCost = Number(
      (vendor.freightBaseCost + agg.totalCbm * vendor.freightPerCbmCost).toFixed(2),
    );
    const insuranceCost = Number(((merchandiseSubtotal * vendor.insurancePct) / 100).toFixed(2));
    const cifValue = merchandiseSubtotal + freightCost + insuranceCost;
    const customsDutyCost = Number(((cifValue * vendor.customsDutyPct) / 100).toFixed(2));
    const portHandlingCost = vendor.portClearanceFee;
    const totalLandedCost = Number(
      (
        merchandiseSubtotal +
        freightCost +
        insuranceCost +
        customsDutyCost +
        portHandlingCost
      ).toFixed(2),
    );
    const landedUnitCostAvg = Number((totalLandedCost / Math.max(1, agg.totalUnits)).toFixed(2));
    const totalLeadDays = vendor.productionLeadDays + vendor.transitLeadDays;

    return {
      vendor,
      merchandiseSubtotal,
      freightCost,
      insuranceCost,
      customsDutyCost,
      portHandlingCost,
      totalLandedCost,
      landedUnitCostAvg,
      totalLeadDays,
      aiCompositeScore: 0,
      badge: null as VendorQuoteEvaluation["badge"],
    };
  });

  if (rawEvals.length === 0) return [];

  const minCost = Math.min(...rawEvals.map((e) => e.totalLandedCost));
  const minDays = Math.min(...rawEvals.map((e) => e.totalLeadDays));

  for (const item of rawEvals) {
    const costScore = (minCost / Math.max(1, item.totalLandedCost)) * 100;
    const speedScore = (minDays / Math.max(1, item.totalLeadDays)) * 100;
    const trustScore = item.vendor.onTimeDeliveryPct * 0.5 + item.vendor.qualityScorePct * 0.5;

    if (strategy === "lowest_landed_cost") {
      item.aiCompositeScore = Math.round(costScore * 0.65 + trustScore * 0.2 + speedScore * 0.15);
    } else if (strategy === "fastest_delivery") {
      item.aiCompositeScore = Math.round(speedScore * 0.65 + trustScore * 0.2 + costScore * 0.15);
    } else {
      item.aiCompositeScore = Math.round(costScore * 0.4 + speedScore * 0.3 + trustScore * 0.3);
    }
  }

  // Assign badges
  const cheapest = [...rawEvals].sort((a, b) => a.totalLandedCost - b.totalLandedCost)[0];
  const fastest = [...rawEvals].sort((a, b) => a.totalLeadDays - b.totalLeadDays)[0];
  const safest = [...rawEvals].sort(
    (a, b) =>
      b.vendor.onTimeDeliveryPct +
      b.vendor.qualityScorePct -
      (a.vendor.onTimeDeliveryPct + a.vendor.qualityScorePct),
  )[0];

  if (cheapest) cheapest.badge = "best_landed_cost";
  if (fastest && fastest.vendor.id !== cheapest?.vendor.id) fastest.badge = "fastest_dock";
  if (
    safest &&
    safest.vendor.id !== cheapest?.vendor.id &&
    safest.vendor.id !== fastest?.vendor.id
  ) {
    safest.badge = "lowest_risk";
  }

  return rawEvals.sort((a, b) => b.aiCompositeScore - a.aiCompositeScore);
}

// --- LocalStorage Persistence With Seed Synthesis ----------------------------

function loadStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveStoredJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

function buildInitialRequisitions(
  products: ErpProduct[],
  orders: ErpSalesOrder[],
  deals: CrmDeal[],
  bots: Bot[],
): PurchaseRequisition[] {
  const p0 = products[0];
  const p1 = products[1] ?? products[0];
  const p2 = products[2] ?? products[0];
  const opsBot = bots.find((b) => b.name.includes("Operations")) ?? bots[0];
  const firstOrder = orders[0];
  const firstDeal = deals[0];

  const defaultLinesA: RequisitionLine[] = [
    {
      productId: p0?.id ?? "prod-1",
      sku: p0?.sku ?? "IND-SERVO-900",
      productName: p0?.name ?? "Industrial Servo Actuator 900W",
      currentStock: p0?.stockOnHand ?? 4,
      requiredQty: 48,
      estimatedUnitCost: p0?.unitPrice ? Math.max(25, Math.round(p0.unitPrice * 0.65)) : 185,
      cartonLengthCm: 60,
      cartonWidthCm: 40,
      cartonHeightCm: 45,
      unitsPerCarton: 4,
      cartonGrossWeightKg: 28,
      hsCode: "8501.52.00",
    },
    ...(p1 && p1.id !== p0?.id
      ? [
          {
            productId: p1.id,
            sku: p1.sku,
            productName: p1.name,
            currentStock: p1.stockOnHand,
            requiredQty: 36,
            estimatedUnitCost: p1.unitPrice ? Math.max(20, Math.round(p1.unitPrice * 0.65)) : 140,
            cartonLengthCm: 55,
            cartonWidthCm: 40,
            cartonHeightCm: 35,
            unitsPerCarton: 6,
            cartonGrossWeightKg: 22,
            hsCode: "8471.80.00",
          },
        ]
      : []),
  ];

  const defaultLinesB: RequisitionLine[] = [
    {
      productId: p2?.id ?? "prod-2",
      sku: p2?.sku ?? "MOD-PLC-GATEWAY",
      productName: p2?.name ?? "Edge Telemetry PLC Controller",
      currentStock: p2?.stockOnHand ?? 2,
      requiredQty: 80,
      estimatedUnitCost: p2?.unitPrice ? Math.max(15, Math.round(p2.unitPrice * 0.6)) : 110,
      cartonLengthCm: 50,
      cartonWidthCm: 40,
      cartonHeightCm: 40,
      unitsPerCarton: 5,
      cartonGrossWeightKg: 19,
      hsCode: "8537.10.00",
    },
  ];

  return [
    {
      id: "pr-seed-101",
      ref: "PR-2026-0101",
      title: firstOrder
        ? `Fulfill Customer Order ${firstOrder.ref} (${firstOrder.companyName ?? "Priority Account"})`
        : "Urgent Backorder & Safety Stock Replenishment Batch",
      purpose: "sales_order_fulfillment",
      purposeRef: firstOrder?.ref ?? "SO-2026-0001",
      purposeJustification:
        "AI Demand Scanner detected confirmed Sales Order commitment exceeding free warehouse stock on hand.",
      marketScope: "dual_source",
      urgency: "critical",
      status: "sourcing_rfq",
      targetDeliveryDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      requiredCertifications: ["ISO-9001", "RoHS"],
      requestedByBotId: opsBot?.id ?? null,
      requestedByName: opsBot?.name ?? "Operations Manager AI",
      lines: defaultLinesA,
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
    {
      id: "pr-seed-102",
      ref: "PR-2026-0102",
      title: firstDeal
        ? `Pre-Source Inventory for Deal ${firstDeal.ref} (${firstDeal.title})`
        : "International FCL Container Consolidation — Q4 Production Buffer",
      purpose: "crm_deal_pre_sourcing",
      purposeRef: firstDeal?.ref ?? "DL-2026-0002",
      purposeJustification:
        "High-value pipeline deal in late stage; pre-sourcing via international ocean FCL saves 28% landed unit cost.",
      marketScope: "international",
      urgency: "high",
      status: "sourcing_rfq",
      targetDeliveryDate: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10),
      requiredCertifications: ["ISO-9001", "CE", "RoHS"],
      requestedByBotId: opsBot?.id ?? null,
      requestedByName: opsBot?.name ?? "Operations Manager AI",
      lines: defaultLinesB,
      createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    },
  ];
}

// =============================================================================
// 1. PROCUREMENT & AI VENDOR SOURCING SECTION
// =============================================================================

export function ProcurementSourcingSection({
  products,
  orders,
  deals,
  companies: _companies,
  bots,
  currency,
  onReloadErp,
  onError,
}: {
  products: ErpProduct[];
  orders: ErpSalesOrder[];
  deals: CrmDeal[];
  companies: CrmCompany[];
  bots: Bot[];
  currency: string;
  onReloadErp: () => void;
  onError: (msg: string) => void;
}) {
  const money = useMoney(currency);
  const [activeTab, setActiveTab] = useState<
    "requisitions" | "sourcing" | "purchase_orders" | "vendors"
  >("requisitions");

  const [vendors, setVendors] = useState<SourcingVendor[]>(() =>
    loadStoredJson(STORAGE_KEYS.vendors, DEFAULT_VENDORS),
  );
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>(() =>
    loadStoredJson(STORAGE_KEYS.requisitions, []),
  );
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRecord[]>(() =>
    loadStoredJson(STORAGE_KEYS.orders, []),
  );
  const [loadPlans, setLoadPlans] = useState<LoadPlanRecord[]>(() =>
    loadStoredJson(STORAGE_KEYS.loadPlans, []),
  );

  // Seed initial requisitions once products arrive if empty
  useEffect(() => {
    if (requisitions.length === 0 && products.length > 0) {
      const seeded = buildInitialRequisitions(products, orders, deals, bots);
      setRequisitions(seeded);
      saveStoredJson(STORAGE_KEYS.requisitions, seeded);
    }
  }, [products, orders, deals, bots, requisitions.length]);

  const [selectedPrId, setSelectedPrId] = useState<string>("");
  const activePr = useMemo(
    () => requisitions.find((r) => r.id === selectedPrId) ?? requisitions[0] ?? null,
    [requisitions, selectedPrId],
  );

  const [sourcingStrategy, setSourcingStrategy] = useState<
    "lowest_landed_cost" | "fastest_delivery" | "balanced_ai"
  >("balanced_ai");
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [createVendorOpen, setCreateVendorOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);

  const opsBot = bots.find((b) => b.name.includes("Operations")) ?? bots[0] ?? null;

  function persistAll(
    nextPrs = requisitions,
    nextPos = purchaseOrders,
    nextPlans = loadPlans,
    nextVendors = vendors,
  ) {
    setRequisitions(nextPrs);
    setPurchaseOrders(nextPos);
    setLoadPlans(nextPlans);
    setVendors(nextVendors);
    saveStoredJson(STORAGE_KEYS.requisitions, nextPrs);
    saveStoredJson(STORAGE_KEYS.orders, nextPos);
    saveStoredJson(STORAGE_KEYS.loadPlans, nextPlans);
    saveStoredJson(STORAGE_KEYS.vendors, nextVendors);
  }

  // Smart AI Demand Scanner: scans live Sales Orders, Deals, and Low Stock SKUs
  function runAiPurposeDrivenScanner() {
    const lowStockSkus = products.filter(
      (p) => p.active && p.stockOnHand <= Math.max(LOW_STOCK_THRESHOLD, 12),
    );
    const targetSkus = lowStockSkus.length > 0 ? lowStockSkus : products.slice(0, 3);
    if (targetSkus.length === 0) {
      setBanner("Add at least one SKU in SKU Catalog to generate AI Purchase Requisitions.");
      return;
    }

    const openOrder = orders.find((o) => o.status !== "cancelled") ?? orders[0];
    const openDeal = deals.find((d) => d.stage !== "lost") ?? deals[0];

    const purpose: RequisitionPurpose = openOrder
      ? "sales_order_fulfillment"
      : openDeal
        ? "crm_deal_pre_sourcing"
        : "safety_stock_eoq";

    const nextNum = 101 + requisitions.length;
    const prRef = `PR-2026-0${nextNum}`;
    const lines: RequisitionLine[] = targetSkus.slice(0, 3).map((prod, idx) => {
      const orderDemand = orders
        .flatMap((o) => o.lines)
        .filter((l) => l.productId === prod.id || l.sku === prod.sku)
        .reduce((s, l) => s + l.quantity, 0);
      const recommendedQty = Math.max(24, orderDemand * 2 + (30 - Math.max(0, prod.stockOnHand)));
      return {
        productId: prod.id,
        sku: prod.sku,
        productName: prod.name,
        currentStock: prod.stockOnHand,
        requiredQty: recommendedQty,
        estimatedUnitCost: Math.max(15, Math.round((prod.unitPrice || 120) * 0.62)),
        cartonLengthCm: 60,
        cartonWidthCm: 40,
        cartonHeightCm: 40,
        unitsPerCarton: idx === 0 ? 4 : 6,
        cartonGrossWeightKg: idx === 0 ? 26 : 20,
        hsCode: prod.hsnCode || "8479.89.99",
      };
    });

    const newPr: PurchaseRequisition = {
      id: `pr-${Date.now()}`,
      ref: prRef,
      title:
        purpose === "sales_order_fulfillment" && openOrder
          ? `AI Demand PR: Fulfill ${openOrder.ref} (${openOrder.companyName ?? "Customer"}) + EOQ Buffer`
          : purpose === "crm_deal_pre_sourcing" && openDeal
            ? `AI Pipeline PR: Pre-Source for ${openDeal.ref} (${openDeal.title})`
            : `AI Safety Stock & EOQ Replenishment (${lines.length} SKUs)`,
      purpose,
      purposeRef:
        purpose === "sales_order_fulfillment"
          ? (openOrder?.ref ?? "SO-DEMAND")
          : purpose === "crm_deal_pre_sourcing"
            ? (openDeal?.ref ?? "DL-PIPELINE")
            : "EOQ-MIN-MAX",
      purposeJustification: `Synthesized by ${opsBot?.name ?? "Operations AI"} from live stock deficits (${lines.map((l) => `${l.sku}: ${l.currentStock} on hand → need ${l.requiredQty}`).join(", ")}).`,
      marketScope: "dual_source",
      urgency: lowStockSkus.some((p) => p.stockOnHand <= 0) ? "critical" : "high",
      status: "sourcing_rfq",
      targetDeliveryDate: new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10),
      requiredCertifications: ["ISO-9001", "RoHS"],
      requestedByBotId: opsBot?.id ?? null,
      requestedByName: opsBot?.name ?? "Operations Manager AI",
      lines,
      createdAt: new Date().toISOString(),
    };

    const nextPrs = [newPr, ...requisitions];
    persistAll(nextPrs);
    setSelectedPrId(newPr.id);
    setBanner(
      `${opsBot?.name ?? "Operations AI"} scanned live ERP demand & generated ${newPr.ref} (${lines.length} SKU lines). Ready for AI Vendor Sourcing.`,
    );
  }

  // Award a Purchase Order to a Vendor from the AI Sourcing Matrix & create Load Plan
  function awardPurchaseOrder(pr: PurchaseRequisition, evaluation: VendorQuoteEvaluation) {
    const poNum = 201 + purchaseOrders.length;
    const poRef = `PO-2026-0${poNum}`;
    const recEquip = recommendOptimalEquipment(pr.lines, evaluation.vendor.market);
    const loadRef = `LP-2026-0${101 + loadPlans.length}`;
    const etaDate = new Date(Date.now() + evaluation.totalLeadDays * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const newLoadPlan: LoadPlanRecord = {
      id: `lp-${Date.now()}`,
      ref: loadRef,
      poRef,
      vendorName: evaluation.vendor.name,
      market: evaluation.vendor.market,
      equipmentCode: recEquip.primary.code,
      vehicleOrContainerNumber:
        evaluation.vendor.market === "international"
          ? `MSCU-${Math.floor(100000 + Math.random() * 899999)}-4`
          : `DL-01-HG-${Math.floor(1000 + Math.random() * 8999)}`,
      sealOrEwayBill:
        evaluation.vendor.market === "international"
          ? `BL-SEAL-${Math.floor(10000 + Math.random() * 89999)}`
          : `EWB-${Math.floor(100000000 + Math.random() * 899999999)}`,
      origin: `${evaluation.vendor.cityPort} (${evaluation.vendor.country})`,
      destination: "Central Distribution Warehouse · Dock A",
      incoterm: evaluation.vendor.defaultIncoterm,
      milestoneStep: 2,
      status: "in_transit",
      lines: pr.lines,
      createdAt: new Date().toISOString(),
    };

    const newPo: PurchaseOrderRecord = {
      id: `po-${Date.now()}`,
      ref: poRef,
      prRef: pr.ref,
      purpose: pr.purpose,
      purposeRef: pr.purposeRef,
      vendorId: evaluation.vendor.id,
      vendorName: evaluation.vendor.name,
      market: evaluation.vendor.market,
      country: evaluation.vendor.country,
      originPortOrHub: evaluation.vendor.cityPort,
      destinationWarehouse: "Central Distribution Warehouse · Dock A",
      transportMode: evaluation.vendor.transportMode,
      incoterm: evaluation.vendor.defaultIncoterm,
      paymentTerms: evaluation.vendor.paymentTerms,
      status: "in_transit",
      lines: pr.lines,
      merchandiseSubtotal: evaluation.merchandiseSubtotal,
      freightCost: evaluation.freightCost,
      insuranceCost: evaluation.insuranceCost,
      customsDutyCost: evaluation.customsDutyCost,
      portHandlingCost: evaluation.portHandlingCost,
      totalLandedCost: evaluation.totalLandedCost,
      etaDate,
      loadPlanId: newLoadPlan.id,
      actorBotId: opsBot?.id ?? null,
      createdAt: new Date().toISOString(),
    };

    const nextPrs = requisitions.map((item) =>
      item.id === pr.id
        ? {
            ...item,
            status: "po_awarded" as const,
            awardedVendorId: evaluation.vendor.id,
            awardedPoRef: poRef,
          }
        : item,
    );

    persistAll(nextPrs, [newPo, ...purchaseOrders], [newLoadPlan, ...loadPlans]);
    setActiveTab("purchase_orders");
    setBanner(
      `Awarded ${poRef} to ${evaluation.vendor.name} (${evaluation.vendor.defaultIncoterm} · Landed Total ${money(evaluation.totalLandedCost)}) and auto-generated ${recEquip.primary.name} load plan (${loadRef}).`,
    );
  }

  // Real-World Dual-Source Split Allocation: 25% Fast Domestic Bridge Stock + 75% Low-Cost International Ocean FCL
  function awardDualSourceSplitPo(pr: PurchaseRequisition) {
    const domVendor = vendors.find((v) => v.market === "domestic") ?? vendors[0];
    const intlVendor = vendors.find((v) => v.market === "international") ?? vendors[1] ?? vendors[0];
    if (!domVendor || !intlVendor) return;

    const domLines: RequisitionLine[] = pr.lines.map((l) => ({
      ...l,
      requiredQty: Math.max(4, Math.ceil(l.requiredQty * 0.25)),
    }));
    const intlLines: RequisitionLine[] = pr.lines.map((l) => ({
      ...l,
      requiredQty: Math.max(4, l.requiredQty - Math.max(4, Math.ceil(l.requiredQty * 0.25))),
    }));

    const domEval = evaluateVendorsForRequisition(
      { ...pr, marketScope: "domestic", lines: domLines },
      [domVendor],
      "fastest_delivery",
    )[0];
    const intlEval = evaluateVendorsForRequisition(
      { ...pr, marketScope: "international", lines: intlLines },
      [intlVendor],
      "lowest_landed_cost",
    )[0];
    if (!domEval || !intlEval) return;

    const poRefDom = `PO-2026-0${201 + purchaseOrders.length}-DOM`;
    const poRefIntl = `PO-2026-0${202 + purchaseOrders.length}-FCL`;
    const lpRefDom = `LP-2026-0${101 + loadPlans.length}`;
    const lpRefIntl = `LP-2026-0${102 + loadPlans.length}`;

    const domEquip = recommendOptimalEquipment(domLines, "domestic");
    const intlEquip = recommendOptimalEquipment(intlLines, "international");

    const lpDom: LoadPlanRecord = {
      id: `lp-dom-${Date.now()}`,
      ref: lpRefDom,
      poRef: poRefDom,
      vendorName: `${domVendor.name} (25% Bridge Express)`,
      market: "domestic",
      equipmentCode: domEquip.primary.code,
      vehicleOrContainerNumber: `MH-14-EX-${Math.floor(1000 + Math.random() * 8999)}`,
      sealOrEwayBill: `EWB-${Math.floor(100000000 + Math.random() * 899999999)}`,
      origin: `${domVendor.cityPort} (Domestic Bridge)`,
      destination: "Central Distribution Warehouse · Express Dock",
      incoterm: domVendor.defaultIncoterm,
      milestoneStep: 3,
      status: "in_transit",
      lines: domLines,
      createdAt: new Date().toISOString(),
    };

    const lpIntl: LoadPlanRecord = {
      id: `lp-intl-${Date.now() + 1}`,
      ref: lpRefIntl,
      poRef: poRefIntl,
      vendorName: `${intlVendor.name} (75% Bulk Ocean FCL)`,
      market: "international",
      equipmentCode: intlEquip.primary.code,
      vehicleOrContainerNumber: `MSCU-${Math.floor(100000 + Math.random() * 899999)}-8`,
      sealOrEwayBill: `BL-SEAL-${Math.floor(10000 + Math.random() * 89999)}`,
      origin: `${intlVendor.cityPort} (${intlVendor.country})`,
      destination: "Central Distribution Warehouse · FCL Dock",
      incoterm: intlVendor.defaultIncoterm,
      milestoneStep: 2,
      status: "in_transit",
      lines: intlLines,
      createdAt: new Date().toISOString(),
    };

    const poDom: PurchaseOrderRecord = {
      id: `po-dom-${Date.now()}`,
      ref: poRefDom,
      prRef: pr.ref,
      purpose: pr.purpose,
      purposeRef: `${pr.purposeRef} · 25% Bridge Stock`,
      vendorId: domVendor.id,
      vendorName: `${domVendor.name} (25% Domestic Bridge)`,
      market: "domestic",
      country: domVendor.country,
      originPortOrHub: domVendor.cityPort,
      destinationWarehouse: "Central Distribution Warehouse · Express Dock",
      transportMode: domVendor.transportMode,
      incoterm: domVendor.defaultIncoterm,
      paymentTerms: domVendor.paymentTerms,
      status: "in_transit",
      lines: domLines,
      merchandiseSubtotal: domEval.merchandiseSubtotal,
      freightCost: domEval.freightCost,
      insuranceCost: domEval.insuranceCost,
      customsDutyCost: domEval.customsDutyCost,
      portHandlingCost: domEval.portHandlingCost,
      totalLandedCost: domEval.totalLandedCost,
      etaDate: new Date(Date.now() + domEval.totalLeadDays * 86_400_000).toISOString().slice(0, 10),
      loadPlanId: lpDom.id,
      actorBotId: opsBot?.id ?? null,
      createdAt: new Date().toISOString(),
    };

    const poIntl: PurchaseOrderRecord = {
      id: `po-intl-${Date.now() + 1}`,
      ref: poRefIntl,
      prRef: pr.ref,
      purpose: pr.purpose,
      purposeRef: `${pr.purposeRef} · 75% Ocean FCL Bulk`,
      vendorId: intlVendor.id,
      vendorName: `${intlVendor.name} (75% Ocean FCL Bulk)`,
      market: "international",
      country: intlVendor.country,
      originPortOrHub: intlVendor.cityPort,
      destinationWarehouse: "Central Distribution Warehouse · FCL Dock",
      transportMode: intlVendor.transportMode,
      incoterm: intlVendor.defaultIncoterm,
      paymentTerms: intlVendor.paymentTerms,
      status: "in_transit",
      lines: intlLines,
      merchandiseSubtotal: intlEval.merchandiseSubtotal,
      freightCost: intlEval.freightCost,
      insuranceCost: intlEval.insuranceCost,
      customsDutyCost: intlEval.customsDutyCost,
      portHandlingCost: intlEval.portHandlingCost,
      totalLandedCost: intlEval.totalLandedCost,
      etaDate: new Date(Date.now() + intlEval.totalLeadDays * 86_400_000).toISOString().slice(0, 10),
      loadPlanId: lpIntl.id,
      actorBotId: opsBot?.id ?? null,
      createdAt: new Date().toISOString(),
    };

    const nextPrs = requisitions.map((item) =>
      item.id === pr.id
        ? { ...item, status: "po_awarded" as const, awardedPoRef: `${poRefDom} + ${poRefIntl}` }
        : item,
    );

    persistAll(nextPrs, [poDom, poIntl, ...purchaseOrders], [lpDom, lpIntl, ...loadPlans]);
    setActiveTab("purchase_orders");
    setBanner(
      `Dual-Source Split Awarded for ${pr.ref}: 25% Domestic Bridge Truck (${poRefDom}, arrives in ${domEval.totalLeadDays}d to prevent stockout) + 75% International Ocean FCL (${poRefIntl}, saves 28% unit cost).`,
    );
  }

  // Receive PO into real PostgreSQL ERP inventory via rpc.erp.inventory.adjust
  async function receivePoIntoInventory(po: PurchaseOrderRecord) {
    if (po.status === "grn_received") return;
    setReceivingPoId(po.id);
    try {
      let totalReceivedUnits = 0;
      for (const line of po.lines) {
        const matchedProduct =
          products.find((p) => p.id === line.productId) ??
          products.find((p) => p.sku.toLowerCase() === line.sku.toLowerCase());

        let productId = matchedProduct?.id;
        if (!productId) {
          const created = await rpc.erp.products.create({
            sku: line.sku,
            name: line.productName,
            unitPrice: Math.round(line.estimatedUnitCost * 1.45),
            initialStock: 0,
            hsnCode: line.hsCode.replaceAll(".", "").slice(0, 8) || "847989",
            ...(po.actorBotId ? { actorBotId: po.actorBotId } : {}),
          });
          productId = created.id;
        }

        await rpc.erp.inventory.adjust({
          productId,
          delta: line.requiredQty,
          reason: `[GRN ${po.ref} · ${po.incoterm} ${po.market.toUpperCase()}] Received from ${po.vendorName} (${po.originPortOrHub}) for ${po.purposeRef}`,
          ...(po.actorBotId ? { actorBotId: po.actorBotId } : {}),
        });
        totalReceivedUnits += line.requiredQty;
      }

      const nextPos = purchaseOrders.map((item) =>
        item.id === po.id ? { ...item, status: "grn_received" as const } : item,
      );
      const nextPrs = requisitions.map((item) =>
        item.ref === po.prRef ? { ...item, status: "fulfilled" as const } : item,
      );
      const nextPlans = loadPlans.map((plan) =>
        plan.poRef === po.ref
          ? { ...plan, milestoneStep: 5, status: "grn_completed" as const }
          : plan,
      );

      persistAll(nextPrs, nextPos, nextPlans);
      onReloadErp();
      setBanner(
        `GRN Completed for ${po.ref}: +${totalReceivedUnits} units posted to live Warehouse Inventory across ${po.lines.length} SKU(s).`,
      );
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setReceivingPoId(null);
    }
  }

  const vendorEvaluations = useMemo(
    () => (activePr ? evaluateVendorsForRequisition(activePr, vendors, sourcingStrategy) : []),
    [activePr, vendors, sourcingStrategy],
  );

  const openPrCount = requisitions.filter((r) => r.status !== "fulfilled").length;
  const activePoValue = purchaseOrders.reduce((s, o) => s + o.totalLandedCost, 0);
  const intlPoCount = purchaseOrders.filter((o) => o.market === "international").length;

  return (
    <div className="space-y-4">
      {/* Top Industrial Command Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" />
            <h2 className="text-sm font-semibold">
              Global & Domestic Procurement-to-Inventory Engine
            </h2>
            <span className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              PR → AI RFQ → PO → Landed Cost → GRN
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Purpose-driven purchase requisitions linked to live Sales Orders, CRM Deals, and EOQ
            thresholds — with Domestic vs. International AI vendor sourcing and full landed-cost
            accounting.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={runAiPurposeDrivenScanner}>
            <Sparkles data-icon="inline-start" />
            AI Scan Demand & Generate PR
          </Button>
          <Button size="sm" onClick={() => setCreatePrOpen(true)}>
            <Plus data-icon="inline-start" />
            New Purpose-Driven PR
          </Button>
        </div>
      </div>

      {banner ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{banner}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setBanner(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* KPI Strip */}
      <KpiGrid>
        <KpiCard
          label="Active Requisitions (PR)"
          value={openPrCount}
          icon={ClipboardList}
          detail={{ label: "Total requisitions", value: requisitions.length }}
        />
        <KpiCard
          label="Approved Global & Local Vendors"
          value={vendors.length}
          icon={Globe}
          detail={{
            label: "International / Domestic",
            value: `${vendors.filter((v) => v.market === "international").length} Intl · ${vendors.filter((v) => v.market === "domestic").length} Dom`,
          }}
        />
        <KpiCard
          label="Contracted PO Landed Value"
          value={money(activePoValue)}
          icon={Ship}
          detail={{
            label: "Purchase orders",
            value: `${purchaseOrders.length} (${intlPoCount} International)`,
          }}
        />
        <KpiCard
          label="GRN Putaway Completed"
          value={purchaseOrders.filter((p) => p.status === "grn_received").length}
          icon={PackageCheck}
          detail={{
            label: "In transit / customs",
            value: purchaseOrders.filter((p) => p.status !== "grn_received").length,
          }}
        />
      </KpiGrid>

      {/* Sub-Navigation Pipeline Pills */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: "requisitions",
                label: `1. Purpose-Driven Requisitions (${requisitions.length})`,
                icon: ClipboardList,
              },
              {
                id: "sourcing",
                label: "2. AI Vendor Sourcing & Landed Cost Matrix",
                icon: Compass,
              },
              {
                id: "purchase_orders",
                label: `3. Purchase Orders & GRN Putaway (${purchaseOrders.length})`,
                icon: FileCheck2,
              },
              {
                id: "vendors",
                label: `4. Global & Domestic Vendors (${vendors.length})`,
                icon: Globe,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-foreground text-background shadow-xs"
                    : "border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <CsvExportButton
          filename={`procurement-${activeTab}`}
          rows={requisitions}
          columns={[
            { header: "PR Ref", value: (r) => r.ref },
            { header: "Title", value: (r) => r.title },
            { header: "Purpose", value: (r) => PURPOSE_META[r.purpose].shortLabel },
            { header: "Purpose Trigger Ref", value: (r) => r.purposeRef },
            { header: "Market Scope", value: (r) => r.marketScope },
            { header: "Urgency", value: (r) => r.urgency },
            { header: "Status", value: (r) => r.status },
            { header: "Target Delivery", value: (r) => r.targetDeliveryDate },
            {
              header: "SKUs",
              value: (r) => r.lines.map((l) => `${l.sku}x${l.requiredQty}`).join("; "),
            },
          ]}
        />
      </div>

      {/* TAB 1: PURPOSE-DRIVEN REQUISITIONS */}
      {activeTab === "requisitions" ? (
        <div className="space-y-3">
          {requisitions.map((pr) => {
            const agg = computeAggregateLogistics(pr.lines);
            const estBudget = pr.lines.reduce((s, l) => s + l.requiredQty * l.estimatedUnitCost, 0);
            const purposeMeta = PURPOSE_META[pr.purpose];
            return (
              <div
                key={pr.id}
                className="rounded-xl border bg-card p-4 transition-colors hover:border-foreground/25"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                        {pr.ref}
                      </span>
                      <StatusBadge label={purposeMeta.shortLabel} tone={purposeMeta.badgeTone} />
                      <span className="rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                        Trigger: {pr.purposeRef}
                      </span>
                      <StatusBadge
                        label={pr.urgency.toUpperCase()}
                        tone={
                          pr.urgency === "critical"
                            ? "destructive"
                            : pr.urgency === "high"
                              ? "warning"
                              : "neutral"
                        }
                      />
                      <StatusBadge
                        label={
                          pr.marketScope === "domestic"
                            ? "Domestic Only"
                            : pr.marketScope === "international"
                              ? "International Import"
                              : "Global Dual-Source (Dom + Intl)"
                        }
                        tone="info"
                      />
                      <StatusBadge
                        label={pr.status.replaceAll("_", " ").toUpperCase()}
                        tone={
                          pr.status === "fulfilled"
                            ? "success"
                            : pr.status === "po_awarded"
                              ? "info"
                              : "warning"
                        }
                      />
                    </div>
                    <h3 className="text-sm font-semibold">{pr.title}</h3>
                    <p className="text-xs text-muted-foreground">{pr.purposeJustification}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-end">
                      <div className="text-[11px] text-muted-foreground">Est. Baseline Budget</div>
                      <div className="font-mono text-sm font-semibold">{money(estBudget)}</div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedPrId(pr.id);
                        setActiveTab("sourcing");
                      }}
                    >
                      <Compass data-icon="inline-start" />
                      AI Source Vendors & RFQ
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </div>
                </div>

                {/* SKU Line Items & Physical Volumetric Footprint */}
                <div className="mt-3 overflow-x-auto rounded-lg border bg-muted/20">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40 text-[11px] text-muted-foreground">
                        <th className="px-3 py-2 font-medium">SKU / Item</th>
                        <th className="px-3 py-2 font-medium">HS Code</th>
                        <th className="px-3 py-2 text-right font-medium">On Hand</th>
                        <th className="px-3 py-2 text-right font-medium">Req. Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Cartons</th>
                        <th className="px-3 py-2 text-right font-medium">Volume (CBM)</th>
                        <th className="px-3 py-2 text-right font-medium">Gross Wt (kg)</th>
                        <th className="px-3 py-2 text-right font-medium">Pallets</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pr.lines.map((line) => {
                        const metrics = computeLineLogistics(line);
                        return (
                          <tr key={`${pr.id}-${line.sku}`}>
                            <td className="px-3 py-2">
                              <span className="font-mono font-medium">{line.sku}</span> ·{" "}
                              <span>{line.productName}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {line.hsCode}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{line.currentStock}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              {line.requiredQty}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{metrics.cartons}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              {metrics.totalCbm} m³
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {metrics.totalWeightKg} kg
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {metrics.estimatedPallets} plt
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      Requested by:{" "}
                      <strong className="text-foreground">{pr.requestedByName}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Target Delivery:{" "}
                      <strong className="font-mono text-foreground">{pr.targetDeliveryDate}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Compliance:{" "}
                      <strong className="text-foreground">
                        {pr.requiredCertifications.join(", ")}
                      </strong>
                    </span>
                  </div>
                  <div className="font-mono">
                    Total Cargo Footprint:{" "}
                    <strong className="text-foreground">{agg.totalCartons} ctns</strong> ·{" "}
                    <strong className="text-foreground">{agg.totalCbm} CBM</strong> ·{" "}
                    <strong className="text-foreground">{agg.totalWeightKg} kg</strong> ·{" "}
                    <strong className="text-foreground">{agg.totalPallets} pallets</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* TAB 2: AI VENDOR SOURCING & LANDED COST MATRIX */}
      {activeTab === "sourcing" ? (
        <div className="space-y-4">
          {/* Requisition Selector & AI Optimization Mode */}
          <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Active Purchase Requisition to Source
              </div>
              <NativeSelect
                aria-label="Active Purchase Requisition to Source"
                value={activePr?.id ?? ""}
                onChange={(e) => setSelectedPrId(e.target.value)}
              >
                {requisitions.map((pr) => (
                  <NativeSelectOption key={pr.id} value={pr.id}>
                    {pr.ref} — {pr.title} ({PURPOSE_META[pr.purpose].shortLabel})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {activePr ? (
                <p className="text-[11px] text-muted-foreground">
                  Purpose Trigger: <strong className="font-mono">{activePr.purposeRef}</strong> ·
                  Target Date: <strong className="font-mono">{activePr.targetDeliveryDate}</strong>{" "}
                  · Scope: <strong className="uppercase">{activePr.marketScope}</strong>
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                AI Sourcing Optimization Objective
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    {
                      id: "balanced_ai",
                      label: "AI Balanced Score",
                      sub: "Cost + Speed + Quality",
                      icon: Sparkles,
                    },
                    {
                      id: "lowest_landed_cost",
                      label: "Lowest Landed Cost",
                      sub: "FOB + Duty + Freight",
                      icon: TrendingDown,
                    },
                    {
                      id: "fastest_delivery",
                      label: "Fastest to Dock",
                      sub: "Urgent Domestic/Air",
                      icon: Zap,
                    },
                  ] as const
                ).map((mode) => {
                  const Icon = mode.icon;
                  const active = sourcingStrategy === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSourcingStrategy(mode.id)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-2 text-start transition-colors",
                        active
                          ? "border-foreground bg-accent text-foreground"
                          : "bg-background text-muted-foreground hover:bg-accent/50",
                      )}
                    >
                      <div className="flex items-center gap-1 text-xs font-semibold">
                        <Icon className="size-3.5" />
                        <span>{mode.label}</span>
                      </div>
                      <span className="text-[10px] opacity-80">{mode.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Vendor Comparison Matrix Cards */}
          {activePr ? (
            <div className="space-y-3">
              {vendorEvaluations.map((ev, index) => {
                const equip = recommendOptimalEquipment(activePr.lines, ev.vendor.market);
                return (
                  <div
                    key={ev.vendor.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 transition-all",
                      index === 0
                        ? "border-foreground/40 ring-1 ring-foreground/15"
                        : "hover:border-foreground/20",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-foreground px-2 py-0.5 font-mono text-xs font-bold text-background">
                            AI Rank #{index + 1} · {ev.aiCompositeScore}/100
                          </span>
                          <h3 className="text-sm font-semibold">{ev.vendor.name}</h3>
                          <StatusBadge
                            label={
                              ev.vendor.market === "international"
                                ? `INTERNATIONAL · ${ev.vendor.country}`
                                : `DOMESTIC · ${ev.vendor.cityPort}`
                            }
                            tone={ev.vendor.market === "international" ? "info" : "success"}
                          />
                          <span className="rounded border bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-semibold">
                            Incoterm: {ev.vendor.defaultIncoterm}
                          </span>
                          {ev.badge === "best_landed_cost" ? (
                            <StatusBadge label="★ BEST TOTAL LANDED COST" tone="success" />
                          ) : null}
                          {ev.badge === "fastest_dock" ? (
                            <StatusBadge label="⚡ FASTEST TIME-TO-DOCK" tone="warning" />
                          ) : null}
                          {ev.badge === "lowest_risk" ? (
                            <StatusBadge label="🛡 HIGHEST QUALITY & OTD" tone="info" />
                          ) : null}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Origin Hub/Port:{" "}
                          <strong className="text-foreground">{ev.vendor.cityPort}</strong> · Mode:{" "}
                          <strong className="uppercase text-foreground">
                            {ev.vendor.transportMode.replaceAll("_", " ")}
                          </strong>{" "}
                          · Recommended Load:{" "}
                          <strong className="text-foreground">
                            {equip.unitsNeeded} × {equip.primary.name} ({equip.volumeUtilizationPct}
                            % CBM)
                          </strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-end">
                          <div className="text-[11px] text-muted-foreground">
                            Total Landed Cost ({ev.vendor.defaultIncoterm})
                          </div>
                          <div className="font-mono text-base font-bold">
                            {money(ev.totalLandedCost)}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {money(ev.landedUnitCostAvg)} / unit · {ev.totalLeadDays} days to dock
                          </div>
                        </div>
                        <Button size="sm" onClick={() => awardPurchaseOrder(activePr, ev)}>
                          <Award data-icon="inline-start" />
                          Award PO & Plan Load
                        </Button>
                      </div>
                    </div>

                    {/* Full Landed Cost & Lead Time Breakdown Strip */}
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs sm:grid-cols-6">
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          1. Ex-Factory / FOB Goods
                        </div>
                        <div className="font-mono font-semibold">
                          {money(ev.merchandiseSubtotal)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          2.{" "}
                          {ev.vendor.market === "international"
                            ? "Ocean/Air Freight"
                            : "Road Truck Freight"}
                        </div>
                        <div className="font-mono font-semibold">{money(ev.freightCost)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          3. Customs Duty ({ev.vendor.customsDutyPct}%)
                        </div>
                        <div className="font-mono font-semibold">{money(ev.customsDutyCost)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          4. Marine Ins. & Port Clearing
                        </div>
                        <div className="font-mono font-semibold">
                          {money(ev.insuranceCost + ev.portHandlingCost)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          5. Lead Time (Prod + Transit)
                        </div>
                        <div className="font-mono font-semibold">
                          {ev.vendor.productionLeadDays}d + {ev.vendor.transitLeadDays}d ={" "}
                          {ev.totalLeadDays}d
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          6. OTD & Quality Score
                        </div>
                        <div className="font-mono font-semibold">
                          {ev.vendor.onTimeDeliveryPct}% OTD · {ev.vendor.qualityScorePct}% Q
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* TAB 3: PURCHASE ORDERS & GRN PUTAWAY */}
      {activeTab === "purchase_orders" ? (
        <div className="space-y-3">
          {purchaseOrders.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center">
              <p className="text-sm font-medium">No Purchase Orders awarded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the AI Vendor Sourcing Matrix tab and click &ldquo;Award PO & Plan Load&rdquo;
                on any vendor quote.
              </p>
              <Button size="sm" className="mt-3" onClick={() => setActiveTab("sourcing")}>
                Go to AI Vendor Sourcing
              </Button>
            </div>
          ) : (
            purchaseOrders.map((po) => (
              <div key={po.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-bold">
                        {po.ref}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        from {po.prRef} ({po.purposeRef})
                      </span>
                      <StatusBadge
                        label={
                          po.market === "international"
                            ? `INTERNATIONAL · ${po.incoterm}`
                            : `DOMESTIC · ${po.incoterm}`
                        }
                        tone={po.market === "international" ? "info" : "success"}
                      />
                      <StatusBadge
                        label={po.status.replaceAll("_", " ").toUpperCase()}
                        tone={po.status === "grn_received" ? "success" : "warning"}
                      />
                    </div>
                    <h3 className="text-sm font-semibold">
                      {po.vendorName} — {po.originPortOrHub} → {po.destinationWarehouse}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Payment Terms: <strong>{po.paymentTerms}</strong> · ETA:{" "}
                      <strong className="font-mono">{po.etaDate}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-end">
                      <div className="text-[11px] text-muted-foreground">Total Landed Cost</div>
                      <div className="font-mono text-sm font-bold">{money(po.totalLandedCost)}</div>
                    </div>
                    {po.status === "grn_received" ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        <Check className="size-3.5" />
                        GRN Posted to Inventory
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        disabled={receivingPoId === po.id}
                        onClick={() => void receivePoIntoInventory(po)}
                      >
                        <PackageCheck data-icon="inline-start" />
                        {receivingPoId === po.id
                          ? "Posting GRN to Stock…"
                          : "Receive GRN & Putaway to Inventory"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs sm:grid-cols-5">
                  <div>
                    <span className="text-[10px] text-muted-foreground">Goods Value: </span>
                    <strong className="font-mono">{money(po.merchandiseSubtotal)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Freight: </span>
                    <strong className="font-mono">{money(po.freightCost)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Customs Duty: </span>
                    <strong className="font-mono">{money(po.customsDutyCost)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Ins. & Port: </span>
                    <strong className="font-mono">
                      {money(po.insuranceCost + po.portHandlingCost)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">SKUs: </span>
                    <strong className="font-mono">
                      {po.lines.map((l) => `${l.sku} (×${l.requiredQty})`).join(", ")}
                    </strong>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* TAB 4: GLOBAL & DOMESTIC VENDOR DIRECTORY */}
      {activeTab === "vendors" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Approved Domestic (Road FTL/LTL) and International (Ocean FCL / Air Cargo) suppliers
              evaluated by AI Vendor Sourcing.
            </p>
            <Button size="sm" variant="outline" onClick={() => setCreateVendorOpen(true)}>
              <Plus data-icon="inline-start" />
              Register Supplier
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {vendors.map((v) => (
              <div key={v.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{v.code}</span>
                      <StatusBadge
                        label={v.market === "international" ? `INTL · ${v.country}` : "DOMESTIC"}
                        tone={v.market === "international" ? "info" : "success"}
                      />
                      <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        {v.defaultIncoterm}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold">{v.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      Origin Port/Hub: {v.cityPort} · Terms: {v.paymentTerms}
                    </p>
                  </div>
                  <div className="text-end font-mono text-xs">
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {v.onTimeDeliveryPct}% OTD
                    </div>
                    <div className="text-muted-foreground">{v.qualityScorePct}% Quality</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5 text-[11px] text-muted-foreground">
                  <span>
                    Lead Time:{" "}
                    <strong className="text-foreground">
                      {v.productionLeadDays + v.transitLeadDays}d
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Duty: <strong className="text-foreground">{v.customsDutyPct}%</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Certs:{" "}
                    <strong className="text-foreground">{v.certifications.join(", ")}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Create Purpose-Driven PR Modal */}
      {createPrOpen ? (
        <CreateRequisitionModal
          products={products}
          orders={orders}
          deals={deals}
          bots={bots}
          nextNumber={101 + requisitions.length}
          onClose={() => setCreatePrOpen(false)}
          onCreate={(created) => {
            const next = [created, ...requisitions];
            persistAll(next);
            setSelectedPrId(created.id);
            setCreatePrOpen(false);
            setBanner(
              `Created Purpose-Driven Requisition ${created.ref} (${PURPOSE_META[created.purpose].shortLabel}).`,
            );
          }}
        />
      ) : null}

      {/* Create Custom Supplier Modal */}
      {createVendorOpen ? (
        <CreateVendorModal
          nextNumber={vendors.length + 1}
          onClose={() => setCreateVendorOpen(false)}
          onCreate={(vendor) => {
            const next = [vendor, ...vendors];
            persistAll(requisitions, purchaseOrders, loadPlans, next);
            setCreateVendorOpen(false);
            setBanner(
              `Added ${vendor.market.toUpperCase()} supplier ${vendor.name} (${vendor.defaultIncoterm}).`,
            );
          }}
        />
      ) : null}
    </div>
  );
}

// =============================================================================
// 2. CONTAINER & TRUCK LOAD PLANNER SECTION
// =============================================================================

export function LogisticsLoadPlannerSection({
  products,
  bots,
  currency,
  onReloadErp,
  onError,
}: {
  products: ErpProduct[];
  bots: Bot[];
  currency: string;
  onReloadErp: () => void;
  onError: (msg: string) => void;
}) {
  const money = useMoney(currency);

  const [loadPlans, setLoadPlans] = useState<LoadPlanRecord[]>(() =>
    loadStoredJson(STORAGE_KEYS.loadPlans, []),
  );
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRecord[]>(() =>
    loadStoredJson(STORAGE_KEYS.orders, []),
  );

  // Seed default International Container + Domestic Truck load plans if empty
  useEffect(() => {
    if (loadPlans.length === 0 && products.length > 0) {
      const p0 = products[0];
      const p1 = products[1] ?? products[0];
      const seeded: LoadPlanRecord[] = [
        {
          id: "lp-seed-intl",
          ref: "LP-2026-0101",
          poRef: "PO-2026-0201",
          vendorName: "Shenzhen Nanshan Opto-Electronics Mfg.",
          market: "international",
          equipmentCode: "20GP",
          vehicleOrContainerNumber: "MSCU-749281-0",
          sealOrEwayBill: "BL-SZ-992814",
          origin: "Port of Shenzhen (CNSZX)",
          destination: "Central Distribution Warehouse · Dock A",
          incoterm: "FOB",
          milestoneStep: 3,
          status: "in_transit",
          lines: [
            {
              productId: p0?.id ?? "p0",
              sku: p0?.sku ?? "IND-SERVO-900",
              productName: p0?.name ?? "Industrial Servo Actuator",
              currentStock: p0?.stockOnHand ?? 5,
              requiredQty: 64,
              estimatedUnitCost: 140,
              cartonLengthCm: 60,
              cartonWidthCm: 45,
              cartonHeightCm: 45,
              unitsPerCarton: 4,
              cartonGrossWeightKg: 32,
              hsCode: "8501.52.00",
            },
            ...(p1 && p1.id !== p0?.id
              ? [
                  {
                    productId: p1.id,
                    sku: p1.sku,
                    productName: p1.name,
                    currentStock: p1.stockOnHand,
                    requiredQty: 48,
                    estimatedUnitCost: 115,
                    cartonLengthCm: 55,
                    cartonWidthCm: 40,
                    cartonHeightCm: 40,
                    unitsPerCarton: 4,
                    cartonGrossWeightKg: 24,
                    hsCode: "8471.80.00",
                  },
                ]
              : []),
          ],
          createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        },
        {
          id: "lp-seed-dom",
          ref: "LP-2026-0102",
          poRef: "PO-2026-0202",
          vendorName: "Bharat Precision Forge & Systems",
          market: "domestic",
          equipmentCode: "TRK-32FT",
          vehicleOrContainerNumber: "MH-12-PQ-8841",
          sealOrEwayBill: "EWB-291044812",
          origin: "Pune Industrial Corridor",
          destination: "Central Distribution Warehouse · Dock B",
          incoterm: "DAP",
          milestoneStep: 2,
          status: "in_transit",
          lines: [
            {
              productId: p0?.id ?? "p0",
              sku: p0?.sku ?? "IND-SERVO-900",
              productName: p0?.name ?? "Industrial Servo Actuator",
              currentStock: p0?.stockOnHand ?? 5,
              requiredQty: 40,
              estimatedUnitCost: 165,
              cartonLengthCm: 60,
              cartonWidthCm: 45,
              cartonHeightCm: 45,
              unitsPerCarton: 4,
              cartonGrossWeightKg: 32,
              hsCode: "8501.52.00",
            },
          ],
          createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        },
      ];
      setLoadPlans(seeded);
      saveStoredJson(STORAGE_KEYS.loadPlans, seeded);
    }
  }, [loadPlans.length, products]);

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const activePlan = useMemo(
    () => loadPlans.find((p) => p.id === selectedPlanId) ?? loadPlans[0] ?? null,
    [loadPlans, selectedPlanId],
  );

  const [selectedEquipmentCode, setSelectedEquipmentCode] = useState<string>("");
  useEffect(() => {
    if (activePlan) setSelectedEquipmentCode(activePlan.equipmentCode);
  }, [activePlan]);

  const activeEquipment = useMemo(
    () =>
      EQUIPMENT_CATALOG.find(
        (e) => e.code === (selectedEquipmentCode || activePlan?.equipmentCode),
      ) ?? EQUIPMENT_CATALOG[0]!,
    [selectedEquipmentCode, activePlan],
  );

  const [banner, setBanner] = useState<string | null>(null);
  const [busyDockGrn, setBusyDockGrn] = useState(false);

  const opsBot = bots.find((b) => b.name.includes("Operations")) ?? bots[0] ?? null;

  function updatePlans(next: LoadPlanRecord[]) {
    setLoadPlans(next);
    saveStoredJson(STORAGE_KEYS.loadPlans, next);
  }

  function changePlanEquipment(code: string) {
    setSelectedEquipmentCode(code);
    if (!activePlan) return;
    const eq = EQUIPMENT_CATALOG.find((e) => e.code === code);
    const next = loadPlans.map((p) =>
      p.id === activePlan.id
        ? {
            ...p,
            equipmentCode: code,
            market:
              eq?.category === "domestic_truck"
                ? ("domestic" as const)
                : ("international" as const),
          }
        : p,
    );
    updatePlans(next);
  }

  async function advanceMilestoneOrReceiveDock(plan: LoadPlanRecord) {
    if (plan.milestoneStep < 4) {
      const nextStep = plan.milestoneStep + 1;
      const next = loadPlans.map((p) =>
        p.id === plan.id
          ? {
              ...p,
              milestoneStep: nextStep,
              status: nextStep === 4 ? ("customs_dock" as const) : ("in_transit" as const),
            }
          : p,
      );
      updatePlans(next);
      setBanner(`Advanced ${plan.ref} (${plan.vehicleOrContainerNumber}) to Stage ${nextStep}/5.`);
      return;
    }

    // Step 5: Complete Dock Unloading & Putaway to Real Database Inventory
    if (plan.status === "grn_completed") return;
    setBusyDockGrn(true);
    try {
      let totalAdded = 0;
      for (const line of plan.lines) {
        const matched =
          products.find((p) => p.id === line.productId) ??
          products.find((p) => p.sku.toLowerCase() === line.sku.toLowerCase()) ??
          products[0];
        if (!matched) continue;
        await rpc.erp.inventory.adjust({
          productId: matched.id,
          delta: line.requiredQty,
          reason: `[Container/Truck Unload ${plan.ref} · ${plan.equipmentCode} ${plan.vehicleOrContainerNumber}] ${plan.origin} → ${plan.destination}`,
          ...(opsBot ? { actorBotId: opsBot.id } : {}),
        });
        totalAdded += line.requiredQty;
      }

      const nextPlans = loadPlans.map((p) =>
        p.id === plan.id ? { ...p, milestoneStep: 5, status: "grn_completed" as const } : p,
      );
      updatePlans(nextPlans);

      const nextPos = purchaseOrders.map((po) =>
        po.ref === plan.poRef ? { ...po, status: "grn_received" as const } : po,
      );
      setPurchaseOrders(nextPos);
      saveStoredJson(STORAGE_KEYS.orders, nextPos);

      onReloadErp();
      setBanner(
        `Dock GRN Putaway Complete for ${plan.vehicleOrContainerNumber}: +${totalAdded} units added to live Warehouse Inventory!`,
      );
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusyDockGrn(false);
    }
  }

  const agg = useMemo(
    () => (activePlan ? computeAggregateLogistics(activePlan.lines) : null),
    [activePlan],
  );
  const aiRec = useMemo(
    () => (activePlan ? recommendOptimalEquipment(activePlan.lines, activePlan.market) : null),
    [activePlan],
  );

  const volPct = agg
    ? Math.min(100, Math.round((agg.totalCbm / activeEquipment.maxVolumeCbm) * 100))
    : 0;
  const wtPct = agg
    ? Math.min(100, Math.round((agg.totalWeightKg / activeEquipment.maxPayloadKg) * 100))
    : 0;
  const palPct = agg
    ? Math.min(100, Math.round((agg.totalPallets / activeEquipment.maxPalletSlots) * 100))
    : 0;

  // Build visual pallet bay slot array for the selected container or truck
  const baySlots = useMemo(() => {
    const slots: Array<{
      slotIndex: number;
      filled: boolean;
      sku?: string;
      productName?: string;
      cartons?: number;
      weightKg?: number;
      zone: "Front Axle / Nose" | "Mid-Deck Center" | "Rear DoorBay";
    }> = [];
    const totalSlots = activeEquipment.maxPalletSlots;
    const lineSlotQueue: Array<{
      sku: string;
      productName: string;
      cartons: number;
      weightKg: number;
    }> = [];

    for (const line of activePlan?.lines ?? []) {
      const m = computeLineLogistics(line);
      const cartonsPerPallet = Math.max(1, Math.ceil(m.cartons / m.estimatedPallets));
      const wtPerPallet = Math.round(m.totalWeightKg / m.estimatedPallets);
      for (let i = 0; i < m.estimatedPallets; i++) {
        lineSlotQueue.push({
          sku: line.sku,
          productName: line.productName,
          cartons: cartonsPerPallet,
          weightKg: wtPerPallet,
        });
      }
    }

    for (let idx = 0; idx < totalSlots; idx++) {
      const item = lineSlotQueue[idx];
      const ratio = idx / Math.max(1, totalSlots);
      const zone =
        ratio < 0.34 ? "Front Axle / Nose" : ratio < 0.68 ? "Mid-Deck Center" : "Rear DoorBay";
      slots.push({
        slotIndex: idx + 1,
        filled: Boolean(item),
        sku: item?.sku,
        productName: item?.productName,
        cartons: item?.cartons,
        weightKg: item?.weightKg,
        zone,
      });
    }
    return slots;
  }, [activeEquipment.maxPalletSlots, activePlan]);

  const milestones =
    activePlan?.market === "international"
      ? [
          "1. Factory Container Stuffing & Seal",
          "2. Origin Port Gate-In & Export Customs",
          "3. Ocean / Air Vessel Transit (B/L)",
          "4. Destination Port & Import Customs (BoE)",
          "5. Warehouse Dock Unload & GRN Putaway",
        ]
      : [
          "1. Vendor Loading & E-Way Bill",
          "2. Interstate Highway Line-Haul",
          "3. Regional Hub & Axle Weighbridge",
          "4. Warehouse Dock Gate-In",
          "5. Dock Unload & GRN Inventory Putaway",
        ];

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" />
            <h2 className="text-sm font-semibold">
              Container & Domestic Truck Load Planning Engine
            </h2>
            <span className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              CBM · Payload Tonnage · Pallet Bay Deck · Customs & Dock GRN
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Simulate 20ft/40ft/40HC Ocean Containers, Air Cargo ULDs, and 32ft/22ft/14ft Domestic
            Trucks with live volumetric cubing, axle weight balance, and 1-click Dock GRN putaway.
          </p>
        </div>
        {aiRec && activePlan ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => changePlanEquipment(aiRec.primary.code)}
          >
            <Sparkles data-icon="inline-start" />
            AI Optimal Fit: {aiRec.primary.code} ({aiRec.volumeUtilizationPct}% CBM)
          </Button>
        ) : null}
      </div>

      {banner ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          <span className="font-medium">{banner}</span>
          <Button variant="ghost" size="sm" onClick={() => setBanner(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* Shipment Selector & Equipment Fleet Switcher */}
      <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Active Shipment / Purchase Order Load Plan
          </div>
          <NativeSelect
            aria-label="Active Shipment / Purchase Order Load Plan"
            value={activePlan?.id ?? ""}
            onChange={(e) => setSelectedPlanId(e.target.value)}
          >
            {loadPlans.map((lp) => (
              <NativeSelectOption key={lp.id} value={lp.id}>
                {lp.ref} · {lp.poRef} — {lp.vendorName} ({lp.equipmentCode} ·{" "}
                {lp.vehicleOrContainerNumber})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {activePlan ? (
            <p className="text-[11px] text-muted-foreground">
              Route: <strong className="text-foreground">{activePlan.origin}</strong> →{" "}
              <strong className="text-foreground">{activePlan.destination}</strong> · Seal/EWB:{" "}
              <strong className="font-mono text-foreground">{activePlan.sealOrEwayBill}</strong>
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Container / Truck Equipment Specification (Interactive Simulation)
          </div>
          <NativeSelect
            aria-label="Container / Truck Equipment Specification"
            value={activeEquipment.code}
            onChange={(e) => changePlanEquipment(e.target.value)}
          >
            <optgroup label="International Ocean & Air Freight Containers">
              {EQUIPMENT_CATALOG.filter((e) => e.category !== "domestic_truck").map((eq) => (
                <NativeSelectOption key={eq.code} value={eq.code}>
                  [{eq.code}] {eq.name} — {eq.maxVolumeCbm} CBM / {eq.maxPayloadKg.toLocaleString()}{" "}
                  kg / {eq.maxPalletSlots} Pallets
                </NativeSelectOption>
              ))}
            </optgroup>
            <optgroup label="Domestic Road Fleet (FTL / LCV / LTL Trucks)">
              {EQUIPMENT_CATALOG.filter((e) => e.category === "domestic_truck").map((eq) => (
                <NativeSelectOption key={eq.code} value={eq.code}>
                  [{eq.code}] {eq.name} — {eq.maxVolumeCbm} CBM / {eq.maxPayloadKg.toLocaleString()}{" "}
                  kg / {eq.maxPalletSlots} Pallets
                </NativeSelectOption>
              ))}
            </optgroup>
          </NativeSelect>
          <p className="text-[11px] text-muted-foreground">
            Internal Deck:{" "}
            <strong className="font-mono text-foreground">
              {activeEquipment.internalLengthM}m L × {activeEquipment.internalWidthM}m W ×{" "}
              {activeEquipment.internalHeightM}m H
            </strong>{" "}
            · Est. Carrier Rate:{" "}
            <strong className="font-mono text-foreground">
              {money(activeEquipment.baseCostEstimate)}
            </strong>
          </p>
        </div>
      </div>

      {/* Volumetric CBM, Payload Tonnage & Pallet Utilization Bars */}
      {agg && activePlan ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">
                1. Volumetric Cube Utilization (CBM)
              </span>
              <span className="font-mono font-bold">
                {agg.totalCbm} / {activeEquipment.maxVolumeCbm} m³ ({volPct}%)
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  volPct > 95 ? "bg-destructive" : volPct >= 65 ? "bg-emerald-500" : "bg-amber-500",
                )}
                style={{ width: `${volPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {activeEquipment.maxVolumeCbm - agg.totalCbm >= 0
                ? `${(activeEquipment.maxVolumeCbm - agg.totalCbm).toFixed(2)} CBM free space available for PO consolidation`
                : `Over-cubed by ${(agg.totalCbm - activeEquipment.maxVolumeCbm).toFixed(2)} CBM — upgrade equipment or split load`}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">
                2. Gross Payload Weight (Tonnage)
              </span>
              <span className="font-mono font-bold">
                {agg.totalWeightKg.toLocaleString()} /{" "}
                {activeEquipment.maxPayloadKg.toLocaleString()} kg ({wtPct}%)
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  wtPct > 95 ? "bg-destructive" : "bg-foreground",
                )}
                style={{ width: `${wtPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Limiting Factor: <strong className="text-foreground">{aiRec?.limitingFactor}</strong>{" "}
              · {agg.totalCartons} master cartons
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">3. Floor Pallet Bay Slots</span>
              <span className="font-mono font-bold">
                {agg.totalPallets} / {activeEquipment.maxPalletSlots} Pallets ({palPct}%)
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  palPct > 100 ? "bg-destructive" : "bg-sky-500",
                )}
                style={{ width: `${palPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {Math.max(0, activeEquipment.maxPalletSlots - agg.totalPallets)} empty floor pallet
              positions remaining
            </p>
          </div>
        </div>
      ) : null}

      {/* Visual 2D Container / Truck Deck Pallet Bay Map */}
      {activePlan ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div>
              <h3 className="text-sm font-semibold">
                Physical Deck Bay Layout — {activeEquipment.name} (
                {activePlan.vehicleOrContainerNumber})
              </h3>
              <p className="text-xs text-muted-foreground">
                Top-down pallet slot map from Front Bulkhead / Tractor Cab to Rear Cargo Doors
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-xs bg-foreground" />
                Loaded SKU Pallet
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-xs border border-dashed bg-muted/40" />
                Available Consolidation Slot
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {baySlots.map((slot) => (
              <div
                key={slot.slotIndex}
                className={cn(
                  "flex flex-col justify-between rounded-lg border p-2.5 text-xs transition-colors",
                  slot.filled
                    ? "border-foreground/30 bg-accent/60 text-foreground"
                    : "border-dashed bg-muted/15 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono font-semibold">BAY #{slot.slotIndex}</span>
                  <span className="opacity-75">{slot.zone.split(" ")[0]}</span>
                </div>
                {slot.filled ? (
                  <div className="my-1.5">
                    <div className="truncate font-mono text-xs font-bold">{slot.sku}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {slot.productName}
                    </div>
                  </div>
                ) : (
                  <div className="my-2 text-center text-[10px] italic">Empty Pallet Slot</div>
                )}
                <div className="flex items-center justify-between border-t pt-1 font-mono text-[10px]">
                  <span>{slot.filled ? `${slot.cartons} ctns` : "0 ctns"}</span>
                  <span>{slot.filled ? `${slot.weightKg} kg` : "0 kg"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Customs, Port & Highway Transit Milestone Tracker + 1-Click Dock GRN */}
      {activePlan ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                {activePlan.market === "international"
                  ? "International Ocean/Air & Customs Clearance Chain"
                  : "Domestic Line-Haul & E-Way Bill Dispatch Chain"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Advance shipment checkpoints or execute final Warehouse Dock GRN Putaway to post
                stock into live ERP inventory.
              </p>
            </div>
            {activePlan.status === "grn_completed" ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                Unloaded & Posted to Inventory (GRN Complete)
              </span>
            ) : (
              <Button
                size="sm"
                disabled={busyDockGrn}
                onClick={() => void advanceMilestoneOrReceiveDock(activePlan)}
              >
                {activePlan.milestoneStep < 4 ? (
                  <>
                    <Truck data-icon="inline-start" />
                    Advance Checkpoint ({activePlan.milestoneStep}/5)
                  </>
                ) : (
                  <>
                    <PackageCheck data-icon="inline-start" />
                    {busyDockGrn
                      ? "Unloading to Inventory…"
                      : "Complete Dock Unload & Post GRN to Inventory"}
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {milestones.map((label, idx) => {
              const stepNum = idx + 1;
              const done = activePlan.milestoneStep >= stepNum;
              const current = activePlan.milestoneStep === stepNum;
              return (
                <div
                  key={label}
                  className={cn(
                    "rounded-lg border p-2.5 text-xs",
                    done
                      ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
                      : current
                        ? "border-foreground bg-accent"
                        : "bg-muted/20 text-muted-foreground",
                  )}
                >
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span>STEP 0{stepNum}</span>
                    {done ? <Check className="size-3.5 text-emerald-500" /> : null}
                  </div>
                  <div className="mt-1 font-medium">{label}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// 3. MODALS: CREATE PURPOSE-DRIVEN PR & REGISTER VENDOR
// =============================================================================

function CreateRequisitionModal({
  products,
  orders,
  deals,
  bots,
  nextNumber,
  onClose,
  onCreate,
}: {
  products: ErpProduct[];
  orders: ErpSalesOrder[];
  deals: CrmDeal[];
  bots: Bot[];
  nextNumber: number;
  onClose: () => void;
  onCreate: (pr: PurchaseRequisition) => void;
}) {
  const idPrefix = useId();
  const [purpose, setPurpose] = useState<RequisitionPurpose>("sales_order_fulfillment");
  const [purposeRef, setPurposeRef] = useState<string>(orders[0]?.ref ?? "SO-2026-0001");
  const [title, setTitle] = useState<string>("");
  const [marketScope, setMarketScope] = useState<MarketScope>("dual_source");
  const [urgency, setUrgency] = useState<"critical" | "high" | "standard">("high");
  const [targetDate, setTargetDate] = useState<string>(
    new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  );
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id ?? "");
  const [qty, setQty] = useState<string>("48");
  const [unitCost, setUnitCost] = useState<string>("125");
  const [justification, setJustification] = useState<string>(
    "Required to fulfill customer demand and maintain warehouse safety stock buffer.",
  );

  const opsBot = bots.find((b) => b.name.includes("Operations")) ?? bots[0] ?? null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const prod = products.find((p) => p.id === selectedProductId) ?? products[0];
    const numericQty = Math.max(1, Number.parseInt(qty, 10) || 24);
    const numericCost = Math.max(1, Number.parseFloat(unitCost) || 100);
    const ref = `PR-2026-0${nextNumber}`;

    onCreate({
      id: `pr-${Date.now()}`,
      ref,
      title:
        title.trim() ||
        `${PURPOSE_META[purpose].shortLabel}: ${prod?.name ?? "Industrial Batch"} (${purposeRef})`,
      purpose,
      purposeRef: purposeRef.trim() || "MRP-AUTO",
      purposeJustification: justification.trim(),
      marketScope,
      urgency,
      status: "sourcing_rfq",
      targetDeliveryDate: targetDate,
      requiredCertifications: ["ISO-9001", "RoHS"],
      requestedByBotId: opsBot?.id ?? null,
      requestedByName: opsBot?.name ?? "Operations Manager AI",
      lines: [
        {
          productId: prod?.id ?? "custom-sku",
          sku: prod?.sku ?? "IND-SKU-01",
          productName: prod?.name ?? "Industrial Component",
          currentStock: prod?.stockOnHand ?? 0,
          requiredQty: numericQty,
          estimatedUnitCost: numericCost,
          cartonLengthCm: 60,
          cartonWidthCm: 40,
          cartonHeightCm: 40,
          unitsPerCarton: 4,
          cartonGrossWeightKg: 24,
          hsCode: prod?.hsnCode || "8479.89.99",
        },
      ],
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-base font-semibold">New Purpose-Driven Purchase Requisition</h3>
            <p className="text-xs text-muted-foreground">
              Every requisition is anchored to an operational trigger (Sales Order, Deal, EOQ, or
              CapEx).
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-purpose`} className="font-medium">
                Requisition Purpose Trigger
              </label>
              <NativeSelect
                id={`${idPrefix}-purpose`}
                value={purpose}
                onChange={(e) => {
                  const next = e.target.value as RequisitionPurpose;
                  setPurpose(next);
                  if (next === "sales_order_fulfillment") {
                    setPurposeRef(orders[0]?.ref ?? "SO-2026-0001");
                  } else if (next === "crm_deal_pre_sourcing") {
                    setPurposeRef(deals[0]?.ref ?? "DL-2026-0001");
                  } else if (next === "safety_stock_eoq") {
                    setPurposeRef("EOQ-SAFETY-BUFFER");
                  } else {
                    setPurposeRef("BOM-Q4-PROD");
                  }
                }}
              >
                {Object.entries(PURPOSE_META).map(([key, meta]) => (
                  <NativeSelectOption key={key} value={key}>
                    {meta.shortLabel}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-ref`} className="font-medium">
                Linked SO / Deal / Project Reference
              </label>
              <Input
                id={`${idPrefix}-ref`}
                value={purposeRef}
                onChange={(e) => setPurposeRef(e.target.value)}
                placeholder="SO-2026-0001 or DL-2026-0002"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-title`} className="font-medium">
              Requisition Title
            </label>
            <Input
              id={`${idPrefix}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Q4 High-Torque Servo Batch for Customer Order"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-sku`} className="font-medium">
                Target SKU
              </label>
              <NativeSelect
                id={`${idPrefix}-sku`}
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
              >
                {products.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.sku} — {p.name} ({p.stockOnHand} on hand)
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-qty`} className="font-medium">
                Required Quantity
              </label>
              <Input
                id={`${idPrefix}-qty`}
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-cost`} className="font-medium">
                Target Unit Cost
              </label>
              <Input
                id={`${idPrefix}-cost`}
                type="number"
                min={1}
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-scope`} className="font-medium">
                Sourcing Market Scope
              </label>
              <NativeSelect
                id={`${idPrefix}-scope`}
                value={marketScope}
                onChange={(e) => setMarketScope(e.target.value as MarketScope)}
              >
                <NativeSelectOption value="dual_source">
                  Global Dual-Source (Dom + Intl)
                </NativeSelectOption>
                <NativeSelectOption value="domestic">Domestic Market Only</NativeSelectOption>
                <NativeSelectOption value="international">
                  International Import Only
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-urgency`} className="font-medium">
                Urgency Priority
              </label>
              <NativeSelect
                id={`${idPrefix}-urgency`}
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as "critical" | "high" | "standard")}
              >
                <NativeSelectOption value="critical">Critical (Stockout)</NativeSelectOption>
                <NativeSelectOption value="high">High Priority</NativeSelectOption>
                <NativeSelectOption value="standard">Standard EOQ</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-date`} className="font-medium">
                Required By Date
              </label>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-just`} className="font-medium">
              Purpose & Business Justification
            </label>
            <Textarea
              id={`${idPrefix}-just`}
              rows={2}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create Requisition & Run AI Sourcing</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateVendorModal({
  nextNumber,
  onClose,
  onCreate,
}: {
  nextNumber: number;
  onClose: () => void;
  onCreate: (vendor: SourcingVendor) => void;
}) {
  const idPrefix = useId();
  const [name, setName] = useState("");
  const [market, setMarket] = useState<"domestic" | "international">("international");
  const [country, setCountry] = useState("Vietnam (VN)");
  const [cityPort, setCityPort] = useState("Port of Hai Phong (VNHPH)");
  const [incoterm, setIncoterm] = useState<IncotermCode>("FOB");
  const [leadDays, setLeadDays] = useState("16");
  const [dutyPct, setDutyPct] = useState("5.0");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const totalDays = Math.max(2, Number.parseInt(leadDays, 10) || 12);
    onCreate({
      id: `vnd-${Date.now()}`,
      code: `VND-0${nextNumber}`,
      name: name.trim(),
      market,
      country: market === "domestic" ? "Domestic" : country.trim(),
      cityPort: cityPort.trim() || "Regional Logistics Hub",
      transportMode: market === "domestic" ? "road_ftl" : "ocean_fcl",
      defaultIncoterm: incoterm,
      currency: "USD",
      priceFactor: market === "international" ? 0.52 : 0.7,
      productionLeadDays: Math.max(1, Math.floor(totalDays * 0.35)),
      transitLeadDays: Math.max(1, Math.ceil(totalDays * 0.65)),
      customsDutyPct: market === "domestic" ? 0 : Number.parseFloat(dutyPct) || 5,
      freightBaseCost: market === "domestic" ? 210 : 920,
      freightPerCbmCost: market === "domestic" ? 15 : 40,
      insurancePct: 0.6,
      portClearanceFee: market === "domestic" ? 0 : 260,
      onTimeDeliveryPct: 96.5,
      qualityScorePct: 98.0,
      paymentTerms: market === "domestic" ? "Net 30 Domestic" : "30% TT / 70% B/L",
      certifications: ["ISO-9001", "RoHS"],
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-semibold">Register Domestic / International Supplier</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-vname`} className="font-medium">
              Supplier Legal Name
            </label>
            <Input
              id={`${idPrefix}-vname`}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Mekong Delta Precision Manufacturing Co."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-vmarket`} className="font-medium">
                Market Classification
              </label>
              <NativeSelect
                id={`${idPrefix}-vmarket`}
                value={market}
                onChange={(e) => {
                  const m = e.target.value as "domestic" | "international";
                  setMarket(m);
                  if (m === "domestic") {
                    setIncoterm("DAP");
                    setDutyPct("0");
                    setLeadDays("4");
                  } else {
                    setIncoterm("FOB");
                    setDutyPct("6.0");
                    setLeadDays("18");
                  }
                }}
              >
                <NativeSelectOption value="international">
                  International Import Supplier
                </NativeSelectOption>
                <NativeSelectOption value="domestic">Domestic Local Supplier</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-vincoterm`} className="font-medium">
                Default Incoterm (2020)
              </label>
              <NativeSelect
                id={`${idPrefix}-vincoterm`}
                value={incoterm}
                onChange={(e) => setIncoterm(e.target.value as IncotermCode)}
              >
                <NativeSelectOption value="FOB">FOB (Free on Board Port)</NativeSelectOption>
                <NativeSelectOption value="CIF">CIF (Cost, Insurance & Freight)</NativeSelectOption>
                <NativeSelectOption value="DDP">DDP (Delivered Duty Paid)</NativeSelectOption>
                <NativeSelectOption value="DAP">DAP (Delivered at Place)</NativeSelectOption>
                <NativeSelectOption value="EXW">EXW (Ex-Works Factory)</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-vcountry`} className="font-medium">
                Country / Region
              </label>
              <Input
                id={`${idPrefix}-vcountry`}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-vport`} className="font-medium">
                Origin Port / Industrial Hub
              </label>
              <Input
                id={`${idPrefix}-vport`}
                value={cityPort}
                onChange={(e) => setCityPort(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-vlead`} className="font-medium">
                Total Lead Time (Days)
              </label>
              <Input
                id={`${idPrefix}-vlead`}
                type="number"
                min={1}
                value={leadDays}
                onChange={(e) => setLeadDays(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-vduty`} className="font-medium">
                Import Customs Tariff (%)
              </label>
              <Input
                id={`${idPrefix}-vduty`}
                type="number"
                min={0}
                step="0.5"
                value={dutyPct}
                onChange={(e) => setDutyPct(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Supplier</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
