import { AccessLogFormat, JsonSchemaType, JsonSchemaVersion, LambdaIntegration, LogGroupLogDestination, MethodLoggingLevel, Model, RequestValidator, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { join } from 'path';

export class AwsApigatewayLambdaCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, "DynamoDB", {
      tableName: "apigateway-lambda-db",
      partitionKey: {
        name: "ClientID",
        type: AttributeType.NUMBER,
      },
      sortKey: {
        name: "OrderId",
        type: AttributeType.NUMBER,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const createOrder = new NodejsFunction(this, "CreateOrder", {
      functionName: "create-order-apigateway-lambda-cdk",
      handler: "handler",
      entry: join(__dirname, "functions", "createOrder.ts"),
      runtime: Runtime.NODEJS_LATEST,
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true }
    });
    const createOrderIntegration = new LambdaIntegration(createOrder);
    table.grantWriteData(createOrder);

    const updateInstallments = new NodejsFunction(this, "UpdateInstallments", {
      functionName: "update-installments-apigateway-lambda-cdk",
      handler: "handler",
      entry: join(__dirname, "functions", "updateInstallments.ts"),
      runtime: Runtime.NODEJS_LATEST,
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true }
    });
    const updateInstallmentsIntegration = new LambdaIntegration(updateInstallments);
    table.grantWriteData(updateInstallments);

    const getOrdersByClient = new NodejsFunction(this, "GetOrdersByClient", {
      functionName: "get-orders-by-client-apigateway-lambda-cdk",
      handler: "handler",
      entry: join(__dirname, "functions", "getOrdersByClient.ts"),
      runtime: Runtime.NODEJS_LATEST,
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: true }
    });
    const getOrdersByClientIntegration = new LambdaIntegration(getOrdersByClient);
    table.grantReadData(getOrdersByClient);

    const restApiLogGroup = new LogGroup(this, 'RestApiLogGroup', {
      logGroupName: "/aws/apigateway/restapi-apigateway-lambda-cdk",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const restApi = new RestApi(this, "RestApi", {
      restApiName: "apigateway-function-cdk",
      deployOptions: {
        tracingEnabled: true,
        loggingLevel: MethodLoggingLevel.INFO,
        accessLogDestination: new LogGroupLogDestination(restApiLogGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
    });

    // Modelo para validação de criação de pedido
    const createOrderModel = new Model(this, "CreateOrderModel", {
      restApi,
      modelName: "CreateOrderModel",
      contentType: "application/json",
      schema: {
        schema: JsonSchemaVersion.DRAFT4,
        title: "CreateOrderModel",
        type: JsonSchemaType.OBJECT,
        properties: {
          clientId: {
            type: JsonSchemaType.NUMBER,
          },
          items: {
            type: JsonSchemaType.ARRAY,
            items: {
              type: JsonSchemaType.OBJECT,
              properties: {
                productId: {
                  type: JsonSchemaType.NUMBER,
                },
                quantity: {
                  type: JsonSchemaType.NUMBER,
                  minimum: 1,
                },
              },
              required: ["productId", "quantity"],
            },
            minItems: 1,
          },
          paymentMethod: {
            type: JsonSchemaType.STRING,
            enum: ["credit_card", "debit_card", "pix"],
          },
          installments: {
            type: JsonSchemaType.NUMBER,
            minimum: 1,
          },
        },
        required: ["clientId", "items", "paymentMethod", "installments"],
      },
    });

    // Modelo para validação de atualização de installments
    const updateInstallmentsModel = new Model(this, "UpdateInstallmentsModel", {
      restApi,
      modelName: "UpdateInstallmentsModel",
      contentType: "application/json",
      schema: {
        schema: JsonSchemaVersion.DRAFT4,
        title: "UpdateInstallmentsModel",
        type: JsonSchemaType.OBJECT,
        properties: {
          installments: {
            type: JsonSchemaType.NUMBER,
            minimum: 1,
          },
        },
        required: ["installments"],
      },
    });

    // Request Validator para validar body
    const requestValidator = new RequestValidator(this, "RequestValidator", {
      restApi,
      requestValidatorName: "BodyValidator",
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // Request Validator para validar query parameters (e opcionalmente body)
    const queryParameterValidator = new RequestValidator(this, "QueryParameterValidator", {
      restApi,
      requestValidatorName: "QueryParameterValidator",
      validateRequestBody: false,
      validateRequestParameters: true,
    });

    restApi.root.addMethod("POST", createOrderIntegration, {
      requestValidator: requestValidator,
      requestModels: {
        "application/json": createOrderModel,
      },
    });

    // Rotas relacionadas a ordens
    const ordersResource = restApi.root.addResource("orders");

    // GET /orders/{clientId} - Lista todas as ordens de um cliente (aceita query parameter ?paymentMethod=xxx para filtrar)
    const clientOrdersResource = ordersResource.addResource("{clientId}");
    clientOrdersResource.addMethod("GET", getOrdersByClientIntegration, {
      requestValidator: queryParameterValidator,
      requestParameters: {
        "method.request.querystring.paymentMethod": false, // false = opcional
      },
    });

    // PATCH /orders/{clientId}/{orderId} - Atualiza installments de um pedido específico
    const orderResource = clientOrdersResource.addResource("{orderId}");
    orderResource.addMethod("PATCH", updateInstallmentsIntegration, {
      requestValidator: requestValidator,
      requestModels: {
        "application/json": updateInstallmentsModel,
      },
    });
  }
}