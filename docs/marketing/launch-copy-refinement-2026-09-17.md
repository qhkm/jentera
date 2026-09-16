# Launch copy and account identity refinement

Prepared on 17 September 2026 on `release/launch-copy-account`.
Deployed and verified on `jentera.ai` and `jentera.aisar.ai` on 17 September 2026.

- `06e26a9`: simplify the launch benefits and strengthen the delegation copy.
- `61e6387`: display the server-confirmed email in the account menu.
- Baseline: deployed ten-chat preview frontend `e0f0db8`.

The offer keeps the dedicated computer, included AI usage, private WhatsApp
support, direct founder access and early features. It removes the universal
Automation Mapping/setup promises. Parallel-computer limits are explained in
the FAQ; approval and activity controls remain in the trust section.
The RM300 introductory saving is calculated from the existing offer constants.
The RM900 giveaway is excluded until entry dates and selection terms are defined.

The original hero presentation and ten-free-chat entry are unchanged.
Payment activation, tax configuration, backend permissions and usage enforcement
are unchanged. The actual founder invite is still available only after verified
payment. Display email comes from the existing authenticated `/api/me` response:
no extra identity request, browser-storage field or authorization by email.

Verification:

- Root workspace: typecheck and nine focused suites, 103 tests passed.
- Scoped release: build and seven focused suites, 87 tests passed.
- Fictional-account browser QA: all eight mobile/tablet/desktop, English/Bahasa,
  dark/light layouts passed, including long-email wrapping at 320px.
- Routes `/`, `/onboard`, `/setup`, `/app` and subscription exits checked.
  No real provider execution, provisioning, email, payment or group join.
- Before/after pricing and account-menu screenshots:
  `/tmp/jentera-launch-copy-qa.jAFGBy/` (local QA artifacts, not product assets).
- No changes to cache headers, production storage keys or onboarding data.

Production release:

- Published source `f7d2cbc`, Pages deployment `9034b68d`.
- Entry bundle `index-C_dCCQBw.js`; account-menu code in shared
  `FounderGroupInvite-CtAfRO7i.js`. Both asset byte hashes match the local build
  on both production domains.
- Published-site browser QA passed all eight layouts, including account email,
  long-email wrapping, simplified benefits, sign-out and ten-chat upgrade states.
  HTML/assets were live; account/API responses remained fictional and intercepted.
- Real anonymous API check confirmed paid checkout enabled and founder invitation
  hidden. No Worker release, database migration or payment configuration changes.
