const axios = require('axios');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const SF_CONFIG = {
    clientId: 'your_consumer_key',
    audience: 'https://<your_domain>.my.salesforce.com', 
    privateKeyPath: './server.key',
    // This is a Service Account username used ONLY for the initial lookup
    adminUsername: 'admin_user@test.com' 
};

/**
 * Helper to get an Access Token for any specific username
 */
async function getAccessToken(targetUsername) {
    const privateKey = fs.readFileSync(SF_CONFIG.privateKeyPath, 'utf8');
    const payload = {
        iss: SF_CONFIG.clientId,
        sub: targetUsername,
        aud: SF_CONFIG.audience,
        exp: Math.floor(Date.now() / 1000) + (3 * 60)
    };

    const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: token
    });

    const res = await axios.post(`${SF_CONFIG.audience}/services/oauth2/token`, params);
    return { token: res.data.access_token, url: res.data.instance_url };
}

/**
 * Helper to find a Username via Federation Identifier
 */
async function getUsernameByFedId(adminAuth, fedId) {
    const gqlQuery = {
        query: `query findUser($fid: String) {
            uiapi {
                query {
                    User(where: { FederationIdentifier: { eq: $fid } }) {
                        edges { node { Username { value } } }
                    }
                }
            }
        }`,
        variables: { fid: fedId }
    };

    const res = await axios.post(`${adminAuth.url}/services/data/v60.0/graphql`, gqlQuery, {
        headers: { 'Authorization': `Bearer ${adminAuth.token}` }
    });

    const edges = res.data.data.uiapi.query.User.edges;
    return edges.length > 0 ? edges[0].node.Username.value : null;
}

/**
 * MAIN EXECUTION FLOW
 */
async function syncPortalData(userFederationId) {
    try {
        console.log(`Resolving username for Federation ID: ${userFederationId}`);
        
        // Step A: Get Admin Token
        const adminAuth = await getAccessToken(SF_CONFIG.adminUsername);

        // Step B: Lookup the real Salesforce Username
        const realUsername = await getUsernameByFedId(adminAuth, userFederationId);
        
        if (!realUsername) throw new Error("No Salesforce user found for this Federation ID.");
        console.log(`Found Username: ${realUsername}`);

        // Step C: Get User-Specific Token (for security/sharing rules)
        const userAuth = await getAccessToken(realUsername);

        // Step D: Get Case Details via GraphQL
        const caseQuery = {
            query: `query getCases {
                uiapi {
                    query {
                        Case(first: 5) {
                            edges { node { CaseNumber { value } Subject { value } } }
                        }
                    }
                }
            }`
        };

        const finalRes = await axios.post(`${userAuth.url}/services/data/v60.0/graphql`, caseQuery, {
            headers: { 'Authorization': `Bearer ${userAuth.token}` }
        });

        console.table(finalRes.data.data.uiapi.query.Case.edges.map(e => e.node));

    } catch (err) {
        console.error("Portal Sync Error:", err.response?.data || err.message);
    }
}

// This value is what we will get from the external portal and pass on to the JWT middleware
syncPortalData('some_user_sso_identifier');
