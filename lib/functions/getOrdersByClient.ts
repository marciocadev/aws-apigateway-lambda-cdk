import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import 'source-map-support/register';

const logger = new Logger({
  serviceName: 'get-orders-by-client',
  logLevel: 'INFO',
});

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

const tracer = new Tracer({ serviceName: 'getOrdersByClient' });
// Instrument the AWS SDK client
const client = tracer.captureAWSv3Client(dynamoClient);

// Valores válidos para paymentMethod (validação básica - enum validation requer Lambda Authorizer no API Gateway)
const VALID_PAYMENT_METHODS = ["credit_card", "debit_card", "pix"] as const;

export const handler = async (
  event: APIGatewayEvent,
  _: Context
): Promise<APIGatewayProxyResult> => {

  try {
    // Extrai clientId dos path parameters
    const clientId = event.pathParameters?.clientId;

    if (!clientId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: false,
          error: "clientId é obrigatório no path",
        }),
      };
    }

    const clientIdNumber = parseInt(clientId);
    if (isNaN(clientIdNumber)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: false,
          error: "clientId deve ser um número válido",
        }),
      };
    }

    // Extrai paymentMethod dos query parameters (opcional)
    const paymentMethod = event.queryStringParameters?.paymentMethod;

    // Valida o paymentMethod se fornecido
    if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod as any)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: false,
          error: `paymentMethod inválido. Valores aceitos: ${VALID_PAYMENT_METHODS.join(", ")}`,
        }),
      };
    }

    logger.info("Buscando ordens do cliente", {
      clientId: clientIdNumber,
      paymentMethod: paymentMethod || 'todos',
    });

    // Prepara a chave de partição para a query
    const keyConditionExpression = 'ClientId = :clientId';
    const expressionAttributeValues: Record<string, any> = {
      ':clientId': clientIdNumber,
    };

    // Adiciona filtro por paymentMethod se fornecido
    let filterExpression: string | undefined;
    if (paymentMethod) {
      filterExpression = 'PaymentMethod = :paymentMethod';
      expressionAttributeValues[':paymentMethod'] = paymentMethod;
    }

    // Busca as ordens do cliente no DynamoDB (com ou sem filtro)
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: keyConditionExpression,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ExpressionAttributeValues: marshall(expressionAttributeValues),
    }));

    // Converte os itens do formato DynamoDB para objetos JavaScript
    const orders = (result.Items || []).map(item => unmarshall(item));

    logger.info("Ordens encontradas", {
      clientId: clientIdNumber,
      paymentMethod: paymentMethod || 'todos',
      count: orders.length,
    });

    // Retorna a lista de ordens
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        clientId: clientIdNumber,
        ...(paymentMethod && { paymentMethod }),
        count: orders.length,
        orders: orders,
      }),
    };

  } catch (err) {
    logger.error("Erro ao buscar ordens do cliente", { error: err });

    // Para erros, retorna 500
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        error: "Erro interno do servidor",
      }),
    };
  }
}