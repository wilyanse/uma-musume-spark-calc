import type { ZodError } from 'zod';

/** RFC 9457 problem details (40 §4). */
export interface ProblemError {
  path?: string;
  message: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly errors: ProblemError[] | undefined;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    title: string,
    detail?: string,
    errors?: ProblemError[],
    headers: Record<string, string> = {},
  ) {
    super(detail ?? title);
    this.status = status;
    this.title = title;
    this.errors = errors;
    this.headers = headers;
  }
}

export function problemResponse(
  status: number,
  title: string,
  detail?: string,
  errors?: ProblemError[],
  headers: Record<string, string> = {},
): Response {
  const body: Record<string, unknown> = { type: 'about:blank', title, status };
  if (detail !== undefined) body.detail = detail;
  if (errors !== undefined) body.errors = errors;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

/** zod issues → `[{path: "/stats/spd", message}]` (JSON-pointer paths, messages verbatim). */
export function zodProblems(error: ZodError): ProblemError[] {
  return error.issues.map((i) => ({
    path: i.path.length ? '/' + i.path.map((p) => String(p)).join('/') : '',
    message: i.message,
  }));
}

export const validationError = (errors: ProblemError[], detail = 'Request validation failed') =>
  new ApiError(422, 'Unprocessable Content', detail, errors);
