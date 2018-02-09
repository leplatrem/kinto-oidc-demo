const KINTO_URL = 'http://localhost:8888/v1'
const SCOPES = 'openid email';
const BUCKET = 'default';
const COLLECTION = 'oidc-demo';


document.addEventListener('DOMContentLoaded', main);

async function main() {
  const kintoClient = new KintoClient(KINTO_URL);
  const authClient = new OpenIDClient();

  const {capabilities: {openid: openidCaps}} = await kintoClient.fetchServerInfo();
  if (!openidCaps) {
    showError("OpenID not enabled on server.");
    return
  }

  // Add one login button for every provider configured.
  const {providers} = openidCaps;
  const loginBar = document.getElementById('login-bar');
  for(const provider of providers) {
    const {name} = provider;
    const loginBtn = document.createElement('button');
    loginBtn.className = 'login';
    loginBtn.textContent = `Login with ${name[0].toUpperCase() + name.substr(1)}`;
    loginBar.insertBefore(loginBtn, loginBar.firstChild);
    loginBtn.addEventListener('click', () => {
      authClient.authorize(provider);
    });
  }

  // Logout button.
  const logoutBtn = document.getElementById('logout');
  logoutBtn.addEventListener('click', () => {
    authClient.logout();
    refreshUI(false);
  });

  // Parse location hash for tokens or read from session storage.
  const authResult = authClient.authenticate();
  window.location.hash = '';

  // Show/hide view and enable/disable login buttons.
  refreshUI(!!authResult);

  if (authResult) {
    console.log('AuthResult', authResult);
    const {provider, accessToken, tokenType, idTokenPayload} = authResult;

    // Set access token for requests to Kinto.
    kintoClient.setHeaders({
      'Authorization': `${tokenType} ${accessToken}`,
    });

    // Refresh UI with infos.
    showTokenPayload(idTokenPayload);
    initRecordForm(kintoClient);
    Promise.all([
      showUserInfo(kintoClient, authClient, provider, accessToken),
      showAPIHello(kintoClient),
      showAPIRecords(kintoClient),
    ])
    .catch(showError);
  }
}


class OpenIDClient {

  async authorize(provider) {
    const {auth_path: authPath, name} = provider;
    const callback = `${window.location.href}#provider=${name}&tokens=`;
    // Redirect the browser to start the OAuth login dance.
    window.location = `${KINTO_URL}${authPath}?callback=${encodeURIComponent(callback)}&scope=${SCOPES}`;
  }

  async userInfo(kintoClient, provider, accessToken) {
    const {capabilities: {openid: {providers}}} = await kintoClient.fetchServerInfo();
    const {userinfo_endpoint: userinfoEndpoint} = providers.filter(({name}) => name == provider)[0];
    const resp = await fetch(userinfoEndpoint, {
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    });
    return await resp.json();
  }

  parseHash() {
    const hash = decodeURIComponent(window.location.hash);
    // Parse tokens from location bar.
    const hashExtract = /provider=(\w+)&tokens=([.\s\S]*)/m.exec(hash);
    if (hashExtract) {
      const provider = hashExtract[1];
      const tokens = hashExtract[2];
      const parsed = JSON.parse(tokens);
      // If parsed info is not access token, raise.
      if (!parsed.access_token) {
        throw new Error(`Authentication error: ${tokens}`);
      }

      const idTokenPayload = JSON.parse(window.atob(parsed.id_token.split('.')[1]));
      return {
        provider,
        expiresIn: parsed.expires_in,
        accessToken: parsed.access_token,
        tokenType: parsed.token_type,
        idToken: parsed.id_token,
        idTokenPayload,
      };
    }
    return {}
  }

  authenticate() {
    let authResult = null;
    try {
      authResult = this.parseHash();
    } catch (err) {
      // Authentication returned an error.
      showError(err);
    }

    if (authResult && authResult.accessToken && authResult.idToken) {
      // Token was passed in location hash by authentication portal.
      // Set the time that the access token will expire at
      const expiresAt = JSON.stringify(
        authResult.expiresIn * 1000 + new Date().getTime()
      );
      sessionStorage.setItem('session', JSON.stringify(authResult));
      sessionStorage.setItem('expires_at', expiresAt);

    } else {
      // Look into session storage for session.
      const expiresAt = JSON.parse(sessionStorage.getItem('expires_at'));
      // Check whether the current time is past the access token's expiry time
      if (new Date().getTime() < expiresAt) {
        authResult = JSON.parse(sessionStorage.getItem('session'));
      }
    }
    return authResult;
  }

  logout() {
    // Remove tokens and expiry time from sessionStorage
    sessionStorage.removeItem('session');
    sessionStorage.removeItem('expires_at');
  }
}


function showError(err) {
  console.error(err);
  const errorDiv = document.getElementById('error');
  errorDiv.style.display = 'block';
  errorDiv.innerText = err;
}

function refreshUI(authenticated) {
  const loginButtons = document.querySelectorAll('#login-bar button.login');
  if (authenticated) {
    loginButtons.forEach((b) => b.setAttribute('disabled', 'disabled'));
    document.getElementById('logout').removeAttribute('disabled');
    document.getElementById('view').style.display = 'block';
  } else {
    loginButtons.forEach((b) => b.removeAttribute('disabled'));
    document.getElementById('logout').setAttribute('disabled', 'disabled');
    document.getElementById('view').style.display = 'none';
  }
}

async function showUserInfo(kintoClient, authClient, provider, accessToken) {
  const profile = await authClient.userInfo(kintoClient, provider, accessToken);
  document.getElementById('profile-nickname').innerText = profile.name;
  document.getElementById('profile-picture').setAttribute('src', profile.picture);
  document.getElementById('profile-details').innerText = JSON.stringify(profile, null, 2);
}

function showTokenPayload(idTokenPayload) {
  const tokenPayloadDiv = document.getElementById('token-payload');
  tokenPayloadDiv.innerText = JSON.stringify(idTokenPayload, null, 2);
}

async function showAPIHello(kintoClient) {
  const data = await kintoClient.fetchServerInfo();

  const apiHelloDiv = document.getElementById('api-hello');
  apiHelloDiv.innerText = JSON.stringify(data, null, 2);
}

function initRecordForm(kintoClient) {
  const newRecordForm = document.getElementById('api-record-form');
  // Submit data.
  newRecordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(newRecordForm);
    const name = formData.get('name');
    const city = formData.get('city');
    await kintoClient.bucket(BUCKET)
                     .collection(COLLECTION)
                     .createRecord({name, city});
    // Empty form once submitted.
    newRecordForm.reset()
    // Refresh list.
    await showAPIRecords(kintoClient);
  });
}

async function showAPIRecords(kintoClient) {
  const apiRecordsDiv = document.getElementById('api-records');
  apiRecordsDiv.innerHTML = '';

  const {data} = await kintoClient.bucket(BUCKET)
                                  .collection(COLLECTION)
                                  .listRecords();
  if (data.length == 0) {
    apiRecordsDiv.innerText = 'Empty';
    return
  }
  for (const {name, city, last_modified} of data) {
    const li = document.createElement('li');
    li.innerText = `${name} (${city})`;
    li.setAttribute('title', new Date(last_modified));
    apiRecordsDiv.appendChild(li);
  }
}
