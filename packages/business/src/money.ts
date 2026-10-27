import { moneyToDecimalString, toMinorUnits } from "@savingroup/contracts";
import { Prisma } from "@savingroup/db";

/** Decimal columns arrive as Prisma.Decimal; the API speaks plain numbers. */
export function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

export function decimalToNullableNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  return decimalToNumber(value);
}

export function toDecimal(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(moneyToDecimalString(amount));
}

/** Exact line and total arithmetic in integer minor units. */
export function lineTotal(quantity: number, unitPrice: number): number {
  return (quantity * toMinorUnits(unitPrice)) / 100;
}

export function sumMoney(values: readonly number[]): number {
  return values.reduce((total, value) => total + toMinorUnits(value), 0) / 100;
}

export function addMoney(left: number, right: number): number {
  return (toMinorUnits(left) + toMinorUnits(right)) / 100;
}
