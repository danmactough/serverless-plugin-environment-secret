# serverless-plugin-environment-secret

Serverless plugin for easily moving environment variables to a Secrets Manager secret

**Why?**

Because [Lambda environment variables have a 4KB service quota that can't be increased](https://repost.aws/knowledge-center/lambda-environment-variable-size). When you have a lot of environment variables (which you will if you're following [12-Factor App](https://12factor.net/config) principles), you can pretty easily exceed this limit.

Moving this configuration to [Secrets Manager effectively increases the limit to 64KB](https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html).

## Installation

1. Use `npm install`

```sh
npm install -D serverless-plugin-environment-secret
```

2. Add the plugin to your `serverless.yml`

```yaml
plugins:
  - serverless-plugin-environment-secret
```

## Usage

- stop using `provider.environment` to provide configuration via environment variables -- only use `provider.environment` when absolutely necessary (such as with `NODE_OPTIONS`, which must be an environment variable to change runtime behavior)
- instead, place that configuration in `custom.environment`
- for any configuration variables that are secrets (such as API keys), store those secrets in Secrets Manager and use the `ssm:/aws/reference/secretsmanager/secret_ID_in_Secrets_Manager` syntax to reference those secrets as demonstrated below
- the name of the environment secret will be exposed via `process.env.SLS_ENVIRONMENT_SECRET_NAME`
- the default name for the environment secret is `${stage}/${service}/environment`, but you can override the default name by defining the variable `SLS_ENVIRONMENT_SECRET_NAME`

```yaml
custom:
  environment:
    DEPLOY_ENV: ${self:provider.stage}
    SomethingNotSecret: 'just-a-string'
    # "Ref" and CloudFormation intrinsic functions, like "Fn::ImportValue" for stack imports, can be used
    SomethingUsingAStackImport: !ImportValue other-stack-${self:provider.stage}-export
    # This is how to specify a secret
    SlackToken:
      SecretValue: ${ssm:/aws/reference/secretsmanager/production/slack/accessToken}
    # This is NOT how to specify a secret and will trigger an error to prevent leaking the secret
    BadSlackToken: ${ssm:/aws/reference/secretsmanager/production/slack/accessToken}
    # You can override the default secret name by defining the variable SLS_ENVIRONMENT_SECRET_NAME
    SLS_ENVIRONMENT_SECRET_NAME: ${self:provider.stage}/my-custom-environment-secret-name
```

When your Serverless application is running locally (using `serverless invoke local` or `serverless offline`), the plugin will automatically add the custom environment to `process.env`.

When your stack is deployed, you'll want to get the secret and add the custom environment to `process.env` with logic something like:

```js
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
const secretsManager = new SecretsManager();

const expandEnvironment = async () => {
  if (!(process.env.IS_OFFLINE || process.env.IS_LOCAL)) {
    const { SecretString } = await secretsManager.getSecretValue({
      SecretId: process.env.SLS_ENVIRONMENT_SECRET_NAME,
    });
    Object.assign(process.env, JSON.parse(SecretString));
  }
};

module.exports.handler = async (event) => {
  await expandEnvironment();

  // handle event
};
```

Check out the [example app](./example/), which you can deploy and play around with to better understand how this plugin works and assure yourself that it prevents secrets from being leaked.
