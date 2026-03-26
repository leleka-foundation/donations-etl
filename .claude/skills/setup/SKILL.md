---
name: setup
description: >
  Interactive setup wizard for configuring donations-etl for your organization. Walks through
  organization identity, GCP project setup, data source credentials, Slack integration, and
  letter template configuration. Use when the user says "set up", "configure", "initialize",
  "install", "get started", "onboard", or asks how to set up the project for their organization.
  Each section is skippable for data sources or integrations the organization does not use.
---

# Donations ETL Setup Wizard

Interactive setup for configuring donations-etl for your nonprofit organization. Each section
can be skipped if not applicable.

## Overview

Tell the user:

> This wizard will walk you through configuring donations-etl for your organization.
> We will set up:
>
> 1. Organization identity (name, address, mission)
> 2. GCP project and infrastructure
> 3. Data source credentials (only the ones you use)
> 4. Slack integration (optional)
> 5. Letter template settings
>
> You can skip any section that does not apply to your organization.

## Step 1: Create .env from template

```bash
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists"
fi
```

Read the current `.env` to check what is already configured.

## Step 2: Organization Identity

Ask the user for their organization details. Use `AskUserQuestion` for each.

| Field                | Env Var                | Description                                                                                                                                                                          | Required |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Organization name    | `ORG_NAME`             | Full legal name (e.g., "Helping Hands Foundation")                                                                                                                                   | Yes      |
| Mailing address      | `ORG_ADDRESS`          | Physical address for letterhead (e.g., "123 Main St, City, ST 12345")                                                                                                                | No       |
| Mission statement    | `ORG_MISSION`          | 1-3 sentence description of the organization's mission and how donations are used                                                                                                    | Yes      |
| Tax status           | `ORG_TAX_STATUS`       | Tax-exempt status statement for letters (e.g., "Helping Hands Foundation is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is 12-3456789.") | Yes      |
| Default signer name  | `DEFAULT_SIGNER_NAME`  | Name of the person who signs donor letters                                                                                                                                           | Yes      |
| Default signer title | `DEFAULT_SIGNER_TITLE` | Title of the signer (e.g., "Executive Director")                                                                                                                                     | Yes      |

Update `.env` with the provided values using the Edit tool.

## Step 3: Organization Logo

Ask: "Do you have a logo file (PNG format) for your letterhead?"

If yes:

- Ask for the file path
- Copy it to `packages/letter/assets/logo.png`
- The letter template will automatically embed it

If no:

- Tell the user they can add one later at `packages/letter/assets/logo.png`

## Step 4: GCP Project Setup

Ask the user for their GCP project configuration:

| Field             | Env Var      | Default       | Description                              |
| ----------------- | ------------ | ------------- | ---------------------------------------- |
| GCP Project ID    | `PROJECT_ID` | (required)    | The Google Cloud project ID              |
| Region            | `REGION`     | `us-central1` | Cloud Run and Artifact Registry region   |
| BigQuery location | `LOCATION`   | `US`          | BigQuery dataset location (multi-region) |

Update `.env` with the values. The `BUCKET` will default to `${PROJECT_ID}-donations-etl`.

Then check if gcloud is installed and authenticated:

```bash
command -v gcloud && gcloud config get-value project
```

If not installed, guide the user to install Google Cloud SDK:

- macOS: `brew install --cask google-cloud-sdk`
- Linux: https://cloud.google.com/sdk/docs/install
- Then: `gcloud auth login && gcloud config set project PROJECT_ID`

## Step 5: Data Sources

For EACH data source, ask the user if they use it. If they skip, leave the env var empty
(the ETL automatically disables sources with missing credentials).

### 5a: Mercury (Bank API)

Ask: "Do you use Mercury for business banking?"

If yes:

1. Guide them: Log in to https://app.mercury.com > Settings > Developers > API Keys
2. Create a read-only API key
3. Ask for `SECRET_MERCURY_API_KEY`
4. Update `.env`

If no: Skip. Tell the user Mercury can be added later.

### 5b: PayPal

Ask: "Do you receive donations through PayPal?"

If yes:

1. Guide them: Go to https://developer.paypal.com/dashboard/ > Apps & Credentials
2. Create or select a Live app
3. Copy Client ID and Secret
4. Ask for:
   - `SECRET_PAYPAL_CLIENT_ID`
   - `SECRET_PAYPAL_SECRET`
5. Update `.env`

If no: Skip.

### 5c: Wise (TransferWise)

Ask: "Do you receive international donations through Wise?"

If yes:

1. Guide them: Go to https://wise.com/settings/api-tokens
2. Create an API token with read access
3. Ask for:
   - `SECRET_WISE_TOKEN`
   - `WISE_PROFILE_ID` (found in Wise dashboard URL or via API)
4. Update `.env`

If no: Skip.

### 5d: Givebutter

Ask: "Do you use Givebutter for fundraising?"

If yes:

1. Guide them: Log in to https://givebutter.com > Settings > Integrations > API
2. Generate a new API key
3. Ask for `SECRET_GIVEBUTTER_API_KEY`
4. Update `.env`

If no: Skip.

### 5e: Venmo

Ask: "Do you receive donations through Venmo?"

If yes:

- Explain that the Venmo connector currently works via CSV export
- Guide: Download transaction history CSV from Venmo and place in the project directory
- The connector parses Venmo's CSV format

If no: Skip.

### 5f: Funraise

Ask: "Do you use Funraise for fundraising?"

If yes:

1. Guide them to the Funraise API settings
2. Ask for API credentials
3. Update `.env`

If no: Skip.

### 5g: Google Sheets (Check Deposits)

Ask: "Do you track check deposits in a Google Spreadsheet?"

If yes:

1. Ask for the spreadsheet ID (from the URL: `https://docs.google.com/spreadsheets/d/{ID}/edit`)
2. Ask for the sheet name (default: `checks`)
3. Update `.env`:
   - `CHECK_DEPOSITS_SPREADSHEET_ID`
   - `CHECK_DEPOSITS_SHEET_NAME`
4. Explain: After provisioning, they must share the spreadsheet with the service account
   (`donations-etl-sa@{PROJECT_ID}.iam.gserviceaccount.com` with Viewer access)

If no: Skip.

## Step 6: Slack Integration (Optional)

Ask: "Do you want to enable Slack integration for generating donor letters via /donor-letter command?"

If yes:

1. Guide them through creating a Slack app:
   - Go to https://api.slack.com/apps > Create New App
   - Choose "From scratch"
   - Name it (e.g., "Donor Letters") and select the workspace
   - Under "OAuth & Permissions", add scopes: `chat:write`, `files:write`, `commands`, `im:write`
   - Under "Slash Commands", create `/donor-letter` pointing to the letter service URL
   - Under "Interactivity & Shortcuts", enable and set the Request URL
   - Install the app to the workspace
2. Ask for:
   - `SLACK_BOT_TOKEN` (starts with `xoxb-`)
   - `SLACK_SIGNING_SECRET` (from Basic Information page)
3. Ask for `LETTER_SERVICE_API_KEY` (any strong random string for REST API auth)
4. Update `.env`

If no:

- Tell the user: "Slack integration skipped. You can still generate letters via the REST API or the /donor-letter Claude skill."
- Set a placeholder for `LETTER_SERVICE_API_KEY` if they want the REST API

## Step 7: Install Dependencies

```bash
bun install
```

## Step 8: Verify Configuration

Run a quick check:

```bash
bun typecheck
bun lint
bun test:run
```

Report results to the user. If tests fail, help debug.

## Step 9: Provision GCP Infrastructure (Optional)

Ask: "Would you like to provision GCP infrastructure now?"

If yes:

1. Ensure gcloud is authenticated: `gcloud auth login`
2. Configure Docker auth: `gcloud auth configure-docker ${REGION}-docker.pkg.dev`
3. Run: `dotenvx run -- ./infra/provision.sh`
4. After completion, verify:
   ```bash
   gcloud run jobs describe donations-etl --region ${REGION}
   ```

If no:

- Tell the user they can run `dotenvx run -- ./infra/provision.sh` later
- Or use the `/provision` skill

## Step 10: Summary

Print a summary of what was configured:

- Organization: {ORG_NAME}
- GCP Project: {PROJECT_ID}
- Enabled sources: list which sources have credentials
- Slack: enabled/disabled
- Letter service: configured/not configured

Suggest next steps:

- Run the ETL locally: use the `/running-etl-locally` skill
- Deploy to GCP: use the `/deploying-etl` skill
- Generate a donor letter: use the `/donor-letter` skill
- Query donation data: use the `/donations-query` skill

## Important Notes

- All credentials are stored in `.env` which is gitignored
- For production, credentials are stored in GCP Secret Manager (handled by provisioning)
- The ETL automatically skips data sources with missing credentials
- You can re-run `/setup` anytime to add new data sources or update configuration
