# Kinto + OpenID Connect

## Setup

* Following [this tutorial](https://developers.google.com/identity/protocols/OpenIDConnect) to setup a project in the Google API Console
* Authorized Javascript origins: `http://localhost:3000`
* Authorized redirect URIs: `http://localhost:8888/v1/openid/google/token?`

## Configure & run Kinto

Install Kinto (if necessary) and initialize a new configuration:

```
$ pip install --user kinto

$ kinto init --ini openid.ini
```

Set the [OpenID settings](https://kinto.readthedocs.io/en/stable/configuration/settings.html#openid):

```ini
kinto.includes = kinto.plugins.default_bucket
                 kinto.plugins.openid

multiauth.policies = google

multiauth.policy.google.use = kinto.plugins.openid.OpenIDConnectPolicy
multiauth.policy.google.issuer_url = https://accounts.google.com
multiauth.policy.google.client_id = 248628588820-XXXXXXXXXXX.apps.googleusercontent.com
multiauth.policy.google.client_secret = UAXXXXXXXXXX
multiauth.policy.google.userid_field = email
```

Start!

```
$ kinto start --ini openid.ini
```

## Run demo

```
    $ python3 -m http.server 3000
```

Access http://localhost:3000
