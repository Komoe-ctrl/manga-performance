import { describe, expect, it } from "vitest";
import { CLIENT_ROLES, canDeposit, isClientRole, seesWholeClient } from "../src/roles";

describe("roles", () => {
  it("recognises the three client roles and nothing else", () => {
    for (const role of CLIENT_ROLES) expect(isClientRole(role)).toBe(true);
    for (const other of ["ADMIN", "CLIENT", "", null, undefined]) expect(isClientRole(other)).toBe(false);
  });
  it("lets direction, contributor and admin deposit, but not the analyst", () => {
    expect(canDeposit("ADMIN")).toBe(true);
    expect(canDeposit("CLIENT_DIRECTION")).toBe(true);
    expect(canDeposit("CLIENT_CONTRIBUTEUR")).toBe(true);
    expect(canDeposit("CLIENT_ANALYSTE")).toBe(false);
  });
  it("gives the whole client to direction and analyst, only assigned entities to the contributor", () => {
    expect(seesWholeClient("CLIENT_DIRECTION")).toBe(true);
    expect(seesWholeClient("CLIENT_ANALYSTE")).toBe(true);
    expect(seesWholeClient("CLIENT_CONTRIBUTEUR")).toBe(false);
  });
});
