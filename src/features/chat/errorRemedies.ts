/**
 * Actionable remediation for provider/auth errors surfaced in the transcript.
 *
 * A turn that dies on "token expired" is not a modelling problem — it is a
 * one-command fix the user has to go find. Matching the handful of errors we
 * know the shell fix for turns each into a play button, while anything
 * unrecognized still renders as plain text (never a guessed command).
 */

export interface ErrorRemedy {
  /** Short imperative label for the button. */
  label: string
  /** Shell command pasted into the session terminal. */
  command: string
  /** One-line explanation shown under the error. */
  hint: string
  /**
   * True when the fix invalidates the current pi process's credentials — the
   * user must restart the session (or at least retry) after running it.
   */
  retryAfter: boolean
}

/**
 * Best-effort AWS profile for the login command. `AWS_PROFILE` is the only
 * signal the renderer can see; without it `aws sso login` targets `default`,
 * which is usually NOT what a multi-profile setup wants — so we say so in the
 * hint rather than silently producing a command that logs into the wrong
 * account.
 */
function awsLoginCommand(profile: string | undefined): { command: string; hint: string } {
  if (profile) {
    return {
      command: `aws sso login --profile ${profile}`,
      hint: `Refreshes the expired SSO token for the "${profile}" profile, then retry.`,
    }
  }
  return {
    command: 'aws sso login',
    hint: 'Refreshes the expired SSO token, then retry. Add --profile <name> if you use named profiles.',
  }
}

/**
 * Map an error message to a runnable fix. Ordered most-specific first;
 * returns null when we do not know a safe command.
 */
export function matchErrorRemedy(
  message: string | undefined,
  context: { awsProfile?: string } = {},
): ErrorRemedy | null {
  if (!message) return null
  const text = message.toLowerCase()

  // AWS SSO token expiry (Bedrock). The message names the fix explicitly.
  if (
    (text.includes('token is expired') || text.includes('token has expired')) &&
    (text.includes('sso') || text.includes('aws'))
  ) {
    const { command, hint } = awsLoginCommand(context.awsProfile)
    return { label: 'Run aws sso login', command, hint, retryAfter: true }
  }

  // Generic expired/invalid AWS credentials.
  if (
    text.includes('expiredtoken') ||
    (text.includes('security token') && text.includes('invalid'))
  ) {
    const { command, hint } = awsLoginCommand(context.awsProfile)
    return { label: 'Refresh AWS credentials', command, hint, retryAfter: true }
  }

  // pi's own OAuth providers (Anthropic/OpenAI/Copilot via `pi /login`).
  if (
    text.includes('oauth') ||
    text.includes('refresh token') ||
    ((text.includes('unauthorized') || text.includes('401')) && text.includes('login'))
  ) {
    return {
      label: 'Run pi /login',
      command: 'pi',
      hint: 'Opens pi in the terminal — use /login to re-authenticate, then retry.',
      retryAfter: true,
    }
  }

  return null
}
