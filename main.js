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
    const {
      authorization_endpoint: authEndpoint,
      client_id: clientID,
    } = this.capabilities

    // Obtain state from Kinto server.
    const resp = await fetch(`${KINTO_URL}/openid/state?callback=${encodeURIComponent(CALLBACK_URL)}`);
    const {state} = await resp.json();

    // Redirect to login form.
    const redirectURI = `${KINTO_URL}/openid/token?`;
    const uri = `${authEndpoint}?client_id=${clientID}&response_type=code&scope=${SCOPES}&redirect_uri=${redirectURI}&state=${state}`;
    window.location = uri;
  }

  async userInfo(accessToken) {
    const {userinfo_endpoint: userinfoEndpoint} = this.capabilities;
    console.log(userinfoEndpoint);
    const resp = await fetch(userinfoEndpoint, {headers: {"Authorization": `Bearer ${accessToken}`}});
    return await resp.json();
  }

  parseHash() {
    const hash = window.location.hash.slice(1);
    const tokenString = hash.replace('tokens=', '');  // XXXX: boooh.
    const tokens = decodeURIComponent(tokenString);
    if (tokens.length > 1) {
      return JSON.parse(tokens);
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

  if (authResult && authResult.access_token && authResult.id_token) {
    // Token was passed in location hash by authentication portal.
    authenticated = true;
    window.location.hash = '';
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
    showTokenPayload(authResult)

    initRecordForm()

    const {access_token: accessToken} = authResult;

    // XXXX buurk
    kintoClient._headers["Authorization"] = `Bearer ${accessToken}`

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
    authResult.expires_in * 1000 + new Date().getTime()
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
    const data = JSON.parse(formData.get('data'));
    await kintoClient.bucket("default").createCollection(formData.get('name'), {data});
    // Empty form once submitted.
    newRecordForm.reset()
    // Refresh list.
    await showAPIRecords();
  });
}

async function showAPIRecords() {
  const apiRecordsDiv = document.getElementById('api-records');
  apiRecordsDiv.innerHTML = '';

  const {data} = await kintoClient.bucket("default").listCollections();
  if (data.length == 0) {
    apiRecordsDiv.innerText = 'Empty';
    return
  }
  for (const obj of data) {
    const _name = document.createElement('h2');
    _name.innerText = obj.id;
    const _body = document.createElement('p');
    _body.className = 'pre';
    _body.innerText = obj;
    apiRecordsDiv.appendChild(_name);
    apiRecordsDiv.appendChild(_body);
  }
}
