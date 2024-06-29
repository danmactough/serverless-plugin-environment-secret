class ServerlessEnvironmentSecret {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.service = this.serverless.service.getServiceName();
    this.stage = this.serverless.service.provider.stage;
    this.stackName = this.serverless.service.provider.stackName;

    this.customEnvironment = this.serverless.service.custom.environment ?? {};
    // We need to evaluate this _before_ the variable gets dereferenced
    const leakingSecretVariables = Object.entries(
      this.customEnvironment
    ).reduce((acc, [key, value]) => {
      if (typeof value === 'string' && value.startsWith('${ssm:/')) {
        acc.push(key);
      }
      return acc;
    }, []);
    if (leakingSecretVariables.length > 0) {
      const errorMessage = `Invalid custom.environment configuration. The following variables will leak secret values: ${leakingSecretVariables.join(
        ', '
      )}`;
      throw new Error(errorMessage);
    }

    this.stackParameters = [];
    this.cfParameters = {};

    serverless.configSchemaHandler.defineCustomProperties({
      type: 'object',
      properties: {
        environment: {
          type: 'object',
          additionalProperties: {
            anyOf: [
              {
                type: 'string',
              },
              {
                type: 'object',
                properties: { SecretValue: { type: 'string' } },
                required: ['SecretValue'],
                additionalProperties: false,
              },
              {
                type: 'object',
                patternProperties: {
                  '^(Fn::|Ref$)': {
                    anyOf: [
                      { type: 'string' },
                      { type: 'object' },
                      { type: 'array' },
                    ],
                  },
                },
                additionalProperties: false,
              },
            ],
          },
        },
      },
    });

    this.hooks = {
      initialize: () => {
        for (const [key, value] of Object.entries(this.customEnvironment)) {
          if (value?.SecretValue) {
            this.stackParameters.push({
              ParameterKey: key,
              ParameterValue: value.SecretValue,
            });
            this.cfParameters[key] = {
              Type: 'String',
              NoEcho: true,
            };
          }
        }
      },
      'before:package:finalize': () => this.#updateCloudFormationTemplate(),
      'before:offline:start': () => this.#expandLocalEnvironment(),
      'after:invoke:local:loadEnvVars': () => this.#expandLocalEnvironment(),
      // The aws:deploy:deploy:createStack hook is NOT related to our main stack!
      // It will be invoked to deploy only the serverless deployment bucket
      // management resources.
      // We cannot have stackParameters during the deployment of this stack
      // because the CloudFormation template does not include any Parameters,
      // so supplying parameters in the createStack command will cause an error.
      // As a result, we add stackParameters AFTER this hook.
      'after:aws:deploy:deploy:createStack': () => this.#addStackParameters(),
    };
  }

  #addStackParameters() {
    if (!this.serverless.service.provider.stackParameters) {
      this.serverless.service.provider.stackParameters = [];
    }
    this.serverless.service.provider.stackParameters.push(
      ...this.stackParameters
    );
  }

  #addParametersToCfTemplate() {
    if (
      !this.serverless.service.provider.compiledCloudFormationTemplate
        .Parameters
    ) {
      this.serverless.service.provider.compiledCloudFormationTemplate.Parameters =
        {};
    }
    Object.assign(
      this.serverless.service.provider.compiledCloudFormationTemplate
        .Parameters,
      this.cfParameters
    );
  }

  #addEnvironmentSecret() {
    const resources = {
      EnvironmentSecret: {
        Type: 'AWS::SecretsManager::Secret',
        Properties: {
          Name: `${this.stage}/${this.service}/environment`,
          Description: `Environment for ${this.stackName}`,
          SecretString: cfJoin('', [
            '{',
            cfJoin(
              ',',
              Object.entries(this.customEnvironment).map(([key, value]) =>
                cfJoin('', [
                  `"${key}": `,
                  cfJoin('', [
                    '"',
                    typeof value === 'string' || !('SecretValue' in value)
                      ? value // The literal value from the config vs.
                      : { Ref: key }, // A Ref to the SecretValue
                    '"',
                  ]),
                ])
              )
            ),
            '}',
          ]),
        },
      },
    };
    const outputs = {
      EnvironmentSecret: {
        Description: 'ARN of the EnvironmentSecret SecretId',
        Value: { Ref: 'EnvironmentSecret' },
        Export: {
          Name: { 'Fn::Sub': '${AWS::StackName}:EnvironmentSecret' },
        },
      },
    };
    Object.assign(
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
      resources
    );
    Object.assign(
      this.serverless.service.provider.compiledCloudFormationTemplate.Outputs,
      outputs,
      // This allows the user to override the stack export for the EnvironmentSecret
      this.serverless.service.provider.compiledCloudFormationTemplate.Outputs
    );
  }

  #updateIamExecutionRole() {
    const policyStatement = {
      Effect: 'Allow',
      Action: ['secretsmanager:GetSecretValue'],
      Resource: [
        {
          'Fn::Sub': `arn:\${AWS::Partition}:secretsmanager:\${AWS::Region}:\${AWS::AccountId}:secret:${this.stage}/${this.service}/environment-*`,
        },
      ],
    };
    const executionRoleMainPolicy =
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources.IamRoleLambdaExecution.Properties.Policies.find(
        (policy) =>
          policy['PolicyName']?.['Fn::Join']?.[1].join(
            policy['PolicyName']?.['Fn::Join']?.[0]
          ) === `${this.service}-${this.stage}-lambda`
      );
    executionRoleMainPolicy.PolicyDocument.Statement.push(policyStatement);
  }

  #expandLocalEnvironment() {
    const stackParameters = this.stackParameters.reduce((acc, cur) => {
      acc[cur.ParameterKey] = cur.ParameterValue;
      return acc;
    }, {});
    Object.assign(process.env, this.customEnvironment, stackParameters);
    Object.assign(
      this.serverless.service.provider.environment,
      this.customEnvironment,
      stackParameters
    );
  }

  #updateCloudFormationTemplate() {
    this.#addParametersToCfTemplate();
    this.#addEnvironmentSecret();
    this.#updateIamExecutionRole();
  }
}

function cfJoin(delimiter, pieces) {
  return { 'Fn::Join': [delimiter, pieces] };
}

module.exports = ServerlessEnvironmentSecret;
