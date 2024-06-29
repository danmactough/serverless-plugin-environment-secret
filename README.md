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
```

When your Serverless application is running locally (using `serverless invoke local` or `serverless offline`), the plugin will automatically add the custom environment to `process.env`.

When your stack is deployed, the plugin will create a Secrets Manager secret named `{stage}/{service name}/environment` and store your custom environment in that secret. Then in your Lambda, you'll want to get the secret and add the custom environment to `process.env` with logic something like:

```js
const { SecretsManager } = require('aws-sdk');
const sm = new SecretsManager();
if (!(process.IS_LOCAL || process.IS_OFFLINE)) {
  const { SecretString } = await sm
    .getSecretValue({
      SecretId: '{stage}/{service name}/environment',
    })
    .promise();
  Object.assign(process.env, JSON.parse(SecretString));
}
```
