import { avatarSrc } from "@features/accounts/avatarSrc";

test("avatarSrc appends revision cache bust", () => {
  expect(avatarSrc(null, 1)).toBeUndefined();
  expect(avatarSrc(undefined, 1)).toBeUndefined();
  expect(avatarSrc("/v1/account/profile/avatar", 3)).toBe(
    "/v1/account/profile/avatar?v=3",
  );
  expect(avatarSrc("/v1/account/profile/avatar?raw=1", 4)).toBe(
    "/v1/account/profile/avatar?raw=1&v=4",
  );
});
