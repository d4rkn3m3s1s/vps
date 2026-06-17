export type LoginInput = {
  email: string;
  password: string;
  twoFactorToken?: string | undefined;
};

// When the password is correct but a 2FA code is still required, login returns
// this instead of tokens so the client can prompt for the code.
export type TwoFactorRequired = {
  twoFactorRequired: true;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
  workspace?: {
    id: string;
    role: string;
  };
};
