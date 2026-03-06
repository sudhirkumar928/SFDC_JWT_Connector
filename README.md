# Salesforce JWT Integration (Node.js)

This project demonstrates a clean Node.js structure for integrating with Salesforce using the JWT Bearer OAuth flow.

The application authenticates with Salesforce using a private key, retrieves a user based on FederationIdentifier using the Salesforce GraphQL API, and then performs operations as that user.

---

## Architecture

```mermaid
flowchart TD

A[Node.js Application] --> B[Generate JWT using Private Key]
B --> C[Salesforce OAuth JWT Bearer Flow]
C --> D[Admin Access Token]

D --> E[GraphQL API Query]
E --> F[Lookup User by FederationIdentifier]
F --> G[Retrieve Username]

G --> H[Generate Second JWT]
H --> I[Authenticate as Community User]
I --> J[Community User Access Token]

J --> K[Fetch Salesforce Data]
```

This architecture uses a dual-token pattern:

1. Authenticate as an integration/admin user.
2. Use GraphQL to retrieve the username associated with a FederationIdentifier.
3. Authenticate again using that community user's username.
4. Perform API operations as that user.

---

## Setting Up an External Client App (ECA) in Salesforce

Using an **External Client App (ECA)** is the modern and secure way to handle OAuth in Salesforce. It is more decoupled than the legacy Connected App approach.

Follow these steps to configure your Salesforce Org for this Node.js integration.

---

### 1. Enable External Client Apps

1. Go to **Setup** in Salesforce.
2. In the **Quick Find** box, type **External Client App Manager**.
3. If you see a **Get Started** or **Enable** button, click it. (In most 2026 Orgs, this is enabled by default.)

---

### 2. Create the App

1. Click **New External Client App**.
2. Fill out **Basic Information**:
   - **External Client App Name**: `Portal_NodeJS_Sync`
   - **Contact Email**: Your email
3. Click **Save**.

---

### 3. Configure OAuth (JWT)

1. Locate your app in the list, click the dropdown arrow, and select **Edit View**.
2. Scroll to the **OAuth Settings** section.
3. Check **Enable OAuth**.
4. **Callback URL**: `https://localhost` (required but not used for JWT Bearer Flow)
5. Check **Enable JWT Bearer Flow**.
6. **Upload Certificate**: Click **Choose File** and upload `server.crt` generated with OpenSSL.
7. **OAuth Scopes**: Select at least:
   - `Access the Salesforce API (api)`
   - `Perform requests at any time (refresh_token, offline_access)`
8. Click **Save**.

---

### 4. Set Security Policies

1. On the same External Client App page, find the **Policies** tab and click **Edit Policies**.
2. **Permitted Users**: Select **Admin approved users are pre-authorized**.
   - This allows JWT-signed requests to authenticate without prompting the user for credentials.
3. Click **Save**.
4. Scroll to **Profiles**, click **Manage Profiles**, and add:
   - Your **Integration/Admin Profile** (for lookup)
   - Your **Community/Customer Portal Profile** (for data sync)

---

### 5. Get Your Client ID

1. Go back to **External Client App Manager**.
2. Find your app and copy the **Consumer Key**.  
   This will be your `SF_CLIENT_ID` in `.env`.

---

### 6. Deploy / Global OAuth Settings

1. In the External Client App Manager, check the **App Status**.
2. If it shows **Not Deployed**, select **Deploy** from the dropdown.
3. Wait **2–5 minutes** for Salesforce to propagate the settings.

---

> Important: Missing any of these steps  especially Profiles or Permitted Users  is the most common cause of **invalid_grant** errors in JWT integrations.

---

## Generating JWT Certificates (OpenSSL)

Salesforce JWT authentication requires a public/private key pair.

The **private key** is used by the Node.js application to sign the JWT.  
The **public certificate** is uploaded to the Salesforce External Client App.

### Step 1  Generate Private Key

```
openssl genrsa -out server.key 2048
```

This creates a **2048-bit RSA private key**.

---

### Step 2  Generate Certificate Signing Request

```
openssl req -new -key server.key -out server.csr
```

You will be prompted to enter some information such as:

```
Country Name
State
Organization
Common Name
```

These values are not critical for the JWT flow.

---

### Step 3  Generate Self-Signed Certificate

```
openssl x509 -req -sha256 -days 3650 -in server.csr -signkey server.key -out server.crt
```

This generates a **public certificate valid for 10 years**.

Files generated:

| File | Purpose |
|-----|------|
| server.key | Private key used to sign JWT tokens |
| server.csr | Certificate signing request |
| server.crt | Public certificate uploaded to Salesforce |

---

### Step 4  Upload Certificate to Salesforce

1. Go to **Setup**
2. Navigate to **External Client App Manager**
3. Open your External Client App
4. Click **Edit OAuth Settings**
5. Upload the file:

```
server.crt
```

---

### Step 5  Store Private Key in Environment Variable

Your application uses the private key from environment variables.

Example `.env`:

```env
SF_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

To convert the key into the correct `.env` format you can run:

```
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' server.key
```

Then paste the output into your `.env` file.

Example:

```
SF_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEv...\n...\n-----END RSA PRIVATE KEY-----"
```

---

The **private key must remain secret** because it is used to generate Salesforce authentication tokens.

---

## Project Structure

```
salesforce-jwt-case-fetch/
│
├── src/
│   ├── config/
│   │   └── sfConfig.js
│   │
│   ├── auth/
│   │   └── jwtAuth.js
│   │
│   ├── services/
│   │   └── salesforceService.js
│   │
│   ├── utils/
│   │   └── graphqlQueries.js
│   │
│   └── index.js
│
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Folder responsibilities:

| Folder | Description |
|------|------|
| config | Loads environment variables and configuration |
| auth | Handles Salesforce JWT authentication |
| services | Contains Salesforce API service logic |
| utils | Stores GraphQL queries or helper utilities |
| index.js | Application entry point |

---

## Environment Configuration

Create a `.env` file in the root directory.

Example `.env`:

```env
SF_CLIENT_ID=your_consumer_key
SF_AUDIENCE=https://your-domain.my.salesforce.com
SF_ADMIN_USERNAME=integration_user@company.com

SF_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

FED_ID_TEST=EXT-USER-1234
```

Environment variables:

| Variable | Description |
|------|------|
| SF_CLIENT_ID | Consumer Key from Salesforce External Client App |
| SF_AUDIENCE | Salesforce login audience or domain |
| SF_ADMIN_USERNAME | Integration user username |
| SF_PRIVATE_KEY | RSA private key used to sign JWT |
| FED_ID_TEST | Federation identifier of the community user |

Note: The private key stored in `.env` must convert newline characters using `\n`.

---

## Configuration Module

File: `src/config/sfConfig.js`

```javascript
require("dotenv").config();

const SF_CONFIG = {
  clientId: process.env.SF_CLIENT_ID,
  audience: process.env.SF_AUDIENCE,
  adminUsername: process.env.SF_ADMIN_USERNAME,
  privateKey: process.env.SF_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

module.exports = SF_CONFIG;
```

---

## JWT Authentication Module

File: `src/auth/jwtAuth.js`

```javascript
const jwt = require("jsonwebtoken");
const axios = require("axios");
const SF_CONFIG = require("../config/sfConfig");

async function getAccessToken(targetUsername) {

  const payload = {
    iss: SF_CONFIG.clientId,
    sub: targetUsername,
    aud: SF_CONFIG.audience,
    exp: Math.floor(Date.now() / 1000) + 180
  };

  const token = jwt.sign(payload, SF_CONFIG.privateKey, {
    algorithm: "RS256"
  });

  const response = await axios.post(
    `${SF_CONFIG.audience}/services/oauth2/token`,
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token
    })
  );

  return response.data.access_token;
}

module.exports = { getAccessToken };
```

---

## GraphQL Queries

File: `src/utils/graphqlQueries.js`

```javascript
const GET_USER_BY_FEDERATION_ID = `
query getUser($fedId: String!) {
  uiapi {
    query {
      User(
        where: { FederationIdentifier: { eq: $fedId } }
      ) {
        edges {
          node {
            Username {
              value
            }
          }
        }
      }
    }
  }
}
`;

module.exports = { GET_USER_BY_FEDERATION_ID };
```

---

## Salesforce Service Layer

File: `src/services/salesforceService.js`

```javascript
const axios = require("axios");
const SF_CONFIG = require("../config/sfConfig");
const { GET_USER_BY_FEDERATION_ID } = require("../utils/graphqlQueries");

async function getUsernameByFederationId(accessToken, fedId) {

  const response = await axios.post(
    `${SF_CONFIG.audience}/services/data/v59.0/graphql`,
    {
      query: GET_USER_BY_FEDERATION_ID,
      variables: { fedId }
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  return response.data.data.uiapi.query.User.edges[0].node.Username.value;
}

module.exports = { getUsernameByFederationId };
```

---

## Application Entry Point

File: `src/index.js`

```javascript
const { getAccessToken } = require("./auth/jwtAuth");
const { getUsernameByFederationId } = require("./services/salesforceService");
const SF_CONFIG = require("./config/sfConfig");

async function run() {

  try {

    console.log("Getting Admin Token");

    const adminToken = await getAccessToken(
      SF_CONFIG.adminUsername
    );

    console.log("Looking up Community User");

    const username = await getUsernameByFederationId(
      adminToken,
      process.env.FED_ID_TEST
    );

    console.log("Community Username:", username);

    console.log("Getting Community User Token");

    const userToken = await getAccessToken(username);

    console.log("User token retrieved successfully");

  } catch (error) {

    console.error(
      error.response?.data || error.message
    );

  }

}

run();
```

---

## Installation

Clone the repository and install dependencies.

```
git clone [https://github.com/sudhirkumar928/SFDC_JWT_Connector.git]
cd your-repo-name
npm install
```

---

## Running the Application

```
node src/index.js
```

The script will:

1. Authenticate with Salesforce using the integration user
2. Look up the community user's username using FederationIdentifier
3. Authenticate as the community user
4. Retrieve the user-specific access token

---

## Security Notes

Do not commit sensitive files.

```
.env
server.key
```

These files should be excluded using `.gitignore`.

In production environments, it is recommended to store secrets in a secure secret management service such as AWS Secrets Manager, Azure Key Vault, or environment variable management in your hosting platform.

---

## License

This project is licensed under the MIT License.
