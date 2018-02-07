const KINTO_URL = 'http://localhost:8888/v1'

const CALLBACK_URL = window.location.href + '#tokens=';
const SCOPES = 'openid email';


const kintoClient = new KintoClient(KINTO_URL);
var authClient;


document.addEventListener('DOMContentLoaded', main);

async function main() {

  const {capabilities: {openid: openidCaps}} = await kintoClient.fetchServerInfo()
  if (!openidCaps) {
    showError("OpenID not enabled on server.");
    return
  }
  authClient = new OpenIDClient(openidCaps);

  // Start authentication process on Login button
  const loginBtn = document.getElementById('login');
  loginBtn.addEventListener('click', () => {
    authClient.authorize();
  });

  // Logout button.
  const logoutBtn = document.getElementById('logout');
  logoutBtn.addEventListener('click', logout);

  handleAuthentication()
}


class OpenIDClient {
  constructor(capabilities) {
    this.capabilities = capabilities;
  }

  async authorize() {
    const {auth_uri: authUri} = this.capabilities;
    // Start OAuth login dance.
    window.location = `${KINTO_URL}${authUri}?callback=${encodeURIComponent(CALLBACK_URL)}&scope=${SCOPES}`;
  }

  async userInfo(accessToken) {
    const {userinfo_endpoint: userinfoEndpoint} = this.capabilities;
    const resp = await fetch(userinfoEndpoint, {headers: {"Authorization": `Bearer ${accessToken}`}});
    return await resp.json();
  }

  parseHash() {
    const hash = decodeURIComponent(window.location.hash);
    // Parse tokens from location bar.
    const tokensExtract = /tokens=([.\s\S]*)/m.exec(hash);
    if (tokensExtract) {
      const tokens = tokensExtract[1];
      const parsed = JSON.parse(tokens);
      // If parsed info is not access token, raise.
      if (!parsed.access_token) {
        throw new Error(`Authentication error: ${tokens}`);
      }

      const jwtPayload = JSON.parse(window.atob(parsed.id_token.split('.')[1]));
      return {
        expiresIn: parsed.expires_in,
        accessToken: parsed.access_token,
        tokenType: parsed.token_type,
        idToken: parsed.id_token,
        idTokenPayload: jwtPayload,
      };
    }
    return {}
  }
}


function handleAuthentication(webAuth0) {
  let authenticated = false;

  let authResult;
  try {
    authResult = authClient.parseHash();
  } catch (err) {
    // Authentication returned an error.
    showError(err);
  }
  window.location.hash = '';

  if (authResult && authResult.accessToken && authResult.idToken) {
    // Token was passed in location hash by authentication portal.
    authenticated = true;
    setSession(authResult);
  } else {
    // Look into session storage for session.
    const expiresAt = JSON.parse(sessionStorage.getItem('expires_at'));
    // Check whether the current time is past the access token's expiry time
    if (new Date().getTime() < expiresAt) {
      authenticated = true;
      authResult = JSON.parse(sessionStorage.getItem('session'));
    }
  }

  // Show/hide menus.
  displayButtons(authenticated)

  // Interact with API if authenticated.
  if (authenticated) {
    console.log('AuthResult', authResult);
    const {accessToken, tokenType} = authResult;

    // Set access token for requests to Kinto.
    kintoClient.setHeaders({
      'Authorization': `${tokenType} ${accessToken}`,
    });

    showTokenPayload(authResult)
    initRecordForm()

    // Refresh UI with infos.
    Promise.all([
      showUserInfo(accessToken),
      showAPIHello(),
      showAPIRecords(),
    ])
    .catch(showError);
  }
}

function showError(err) {
  console.error(err);
  const errorDiv = document.getElementById('error');
  errorDiv.style.display = 'block';
  errorDiv.innerText = err;
}

function displayButtons(authenticated) {
  if (authenticated) {
    document.getElementById('login').setAttribute('disabled', 'disabled');
    document.getElementById('logout').removeAttribute('disabled');
    document.getElementById('view').style.display = 'block';
  } else {
    document.getElementById('login').removeAttribute('disabled');
    document.getElementById('logout').setAttribute('disabled', 'disabled');
    document.getElementById('view').style.display = 'none';
  }
}

function setSession(authResult) {
  // Set the time that the access token will expire at
  const expiresAt = JSON.stringify(
    authResult.expiresIn * 1000 + new Date().getTime()
  );
  sessionStorage.setItem('session', JSON.stringify(authResult));
  sessionStorage.setItem('expires_at', expiresAt);
}

function logout() {
  // Remove tokens and expiry time from sessionStorage
  sessionStorage.removeItem('session');
  sessionStorage.removeItem('expires_at');
  displayButtons(false);
}

async function showUserInfo(accessToken) {
  const profile = await authClient.userInfo(accessToken);
  document.getElementById('profile-nickname').innerText = profile.name;
  document.getElementById('profile-picture').setAttribute('src', profile.picture);
  document.getElementById('profile-details').innerText = JSON.stringify(profile, null, 2);
}

function showTokenPayload(authResult) {
  const tokenPayloadDiv = document.getElementById('token-payload');
  tokenPayloadDiv.innerText = JSON.stringify(authResult.idTokenPayload, null, 2);
}

async function showAPIHello() {
  const data = await kintoClient.fetchServerInfo();

  const apiHelloDiv = document.getElementById('api-hello');
  apiHelloDiv.innerText = JSON.stringify(data, null, 2);
}

function initRecordForm() {
  const newRecordForm = document.getElementById('api-record-form');
  // Submit data.
  newRecordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(newRecordForm);
    const city = formData.get('city');
    await kintoClient.bucket("default")
                     .collection("oidc-demo")
                     .createRecord({name: formData.get('name'), city});
    // Empty form once submitted.
    newRecordForm.reset()
    // Refresh list.
    await showAPIRecords();
  });
}

async function showAPIRecords() {
  const apiRecordsDiv = document.getElementById('api-records');
  apiRecordsDiv.innerHTML = '';

  const {data} = await kintoClient.bucket("default")
                                  .collection("oidc-demo")
                                  .listRecords();
  if (data.length == 0) {
    apiRecordsDiv.innerText = 'Empty';
    return
  }
  for (const {name, city} of data) {
    const _name = document.createElement('h2');
    _name.innerText = name;
    const _city = document.createElement('p');
    _city.className = 'pre';
    _city.innerText = city;
    apiRecordsDiv.appendChild(_name);
    apiRecordsDiv.appendChild(_city);
  }
}
