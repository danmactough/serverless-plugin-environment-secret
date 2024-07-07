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
  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        input: event,
        processEnv: process.env,
      },
      null,
      2
    ),
  };
};
