import { ConnectorError, type FetchLike, throwForStatus } from "@headroom/core";
import { apiHeaders, customerUrl } from "./endpoints.ts";
import { authErrorSchema, businessEnvelopeSchema, customerSchema } from "./schemas.ts";

export async function readJson(
  http: FetchLike,
  url: string,
  label: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await http(url, { ...init, redirect: "error" });
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError("provider_unavailable", `${label} request failed`);
  }
  throwForStatus(response, label);
  try {
    return await response.json();
  } catch {
    throw new ConnectorError("invalid_response", `${label} reply was unreadable`);
  }
}
export function checkAuthentication(body: unknown): void {
  if (authErrorSchema.safeParse(body).success)
    throw new ConnectorError(
      "authentication_required",
      "Z.ai sign-in expired or was rejected; reconnect in your browser",
    );
}
export function businessData(body: unknown): unknown {
  checkAuthentication(body);
  const parsed = businessEnvelopeSchema.safeParse(body);
  if (!parsed.success)
    throw new ConnectorError("invalid_response", "Z.ai session response shape changed");
  return parsed.data.data;
}
export async function customerIdentity(http: FetchLike, token: string): Promise<string> {
  const body = await readJson(http, customerUrl, "Z.ai account identity", {
    method: "GET",
    headers: apiHeaders(token, true),
  });
  const parsed = customerSchema.safeParse(businessData(body));
  if (!parsed.success)
    throw new ConnectorError("invalid_response", "Z.ai account identity response shape changed");
  return parsed.data.customerNumber;
}
