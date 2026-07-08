import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import GitHubStrategy from 'passport-github2';
import User from '../models/user.model.js';
import logger from '../utils/logger.js';

/**
 * Configures Passport with Google and GitHub OAuth 2.0 strategies.
 *
 * Both strategies follow the same pattern:
 *   1. Receive profile from OAuth provider
 *   2. Find existing user by (provider, providerId) — or create new
 *   3. Pass user to the done() callback
 *
 * The actual JWT issuance happens in the auth controller, not here.
 * Passport is only used for the OAuth handshake.
 */
export function configurePassport(): void {
  // -------------------------------------------------------------------------
  // Serialize / Deserialize (minimal — we use JWT, not sessions for auth)
  // -------------------------------------------------------------------------
  passport.serializeUser((user: any, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // -------------------------------------------------------------------------
  // Google OAuth 2.0
  // -------------------------------------------------------------------------
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL;

  if (googleClientId && googleClientSecret && googleCallbackUrl) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackUrl,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email =
              profile.emails?.[0]?.value || `${profile.id}@google.oauth`;
            const avatar = profile.photos?.[0]?.value || '';

            let user = await User.findOne({
              provider: 'google',
              providerId: profile.id,
            });

            if (!user) {
              user = await User.create({
                provider: 'google',
                providerId: profile.id,
                email,
                name: profile.displayName || email.split('@')[0],
                avatar,
              });
              logger.success(`New Google user created: ${email}`);
            } else {
              logger.info(`Google user logged in: ${email}`);
            }

            done(null, user);
          } catch (err) {
            logger.error('Google OAuth error:', err);
            done(err as Error);
          }
        }
      )
    );
    logger.info('Google OAuth strategy configured');
  } else {
    logger.warn('Google OAuth credentials not set — strategy skipped');
  }

  // -------------------------------------------------------------------------
  // GitHub OAuth 2.0
  // -------------------------------------------------------------------------
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const githubCallbackUrl = process.env.GITHUB_CALLBACK_URL;

  if (githubClientId && githubClientSecret && githubCallbackUrl) {
    passport.use(
      new GitHubStrategy.Strategy(
        {
          clientID: githubClientId,
          clientSecret: githubClientSecret,
          callbackURL: githubCallbackUrl,
          scope: ['user:email'],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: GitHubStrategy.Profile,
          done: (err: Error | null, user?: any) => void
        ) => {
          try {
            const email =
              (profile.emails?.[0]?.value as string) ||
              `${profile.id}@github.oauth`;
            const avatar =
              (profile.photos?.[0]?.value as string) || '';

            let user = await User.findOne({
              provider: 'github',
              providerId: profile.id,
            });

            if (!user) {
              user = await User.create({
                provider: 'github',
                providerId: profile.id,
                email,
                name:
                  profile.displayName ||
                  (profile.username as string) ||
                  email.split('@')[0],
                avatar,
              });
              logger.success(`New GitHub user created: ${email}`);
            } else {
              logger.info(`GitHub user logged in: ${email}`);
            }

            done(null, user);
          } catch (err) {
            logger.error('GitHub OAuth error:', err);
            done(err as Error);
          }
        }
      )
    );
    logger.info('GitHub OAuth strategy configured');
  } else {
    logger.warn('GitHub OAuth credentials not set — strategy skipped');
  }
}
