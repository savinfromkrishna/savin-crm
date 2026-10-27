import type { BusinessError, BusinessErrorCode } from "@savingroup/contracts";
import type { ZodError } from "zod";

/** A business rule or lookup failed. The code is part of the action contract. */
export class BusinessActionError extends Error {
  readonly code: BusinessErrorCode;
  readonly issues?: BusinessError["issues"];

  constructor(code: BusinessErrorCode, message: string, issues?: BusinessError["issues"]) {
    super(message);
    this.name = "BusinessActionError";
    this.code = code;
    this.issues = issues;
  }

  toJSON(): BusinessError {
    return {
      code: this.code,
      message: this.message,
      ...(this.issues?.length ? { issues: this.issues } : {}),
    };
  }
}

export function notFound(what: string): BusinessActionError {
  return new BusinessActionError("not_found", `${what} not found.`);
}

export function invalidState(message: string): BusinessActionError {
  return new BusinessActionError("invalid_state", message);
}

export function conflict(message: string): BusinessActionError {
  return new BusinessActionError("conflict", message);
}

export function permissionDenied(message: string): BusinessActionError {
  return new BusinessActionError("permission_denied", message);
}

export function insufficientStock(message: string): BusinessActionError {
  return new BusinessActionError("insufficient_stock", message);
}

export function invalidInput(
  message: string,
  issues?: BusinessError["issues"],
): BusinessActionError {
  return new BusinessActionError("invalid_input", message, issues);
}

export function invalidInputFromZod(error: ZodError): BusinessActionError {
  const issues = error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(input)",
    message: issue.message,
  }));
  const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return invalidInput(`Invalid input. ${summary}`, issues);
}

export function isBusinessActionError(error: unknown): error is BusinessActionError {
  return error instanceof BusinessActionError;
}
