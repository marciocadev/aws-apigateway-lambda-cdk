import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import 'source-map-support/register';

const logger = new Logger({
  serviceName: 'update-installments',
  logLevel: 'INFO',
});

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: APIGatewayEvent,
  _: Context
): Promise<APIGatewayProxyResult> => {

  try {
    // Extrai clientId e orderId dos path parameters
    const clientId = event.pathParameters?.clientId;
    const orderId = event.pathParameters?.orderId;

    if (!clientId || !orderId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: false,
          error: "clientId e orderId são obrigatórios no path",
        }),
      };
    }

    // Validação agora é feita pelo API Gateway Request Validation
    // Apenas fazemos parse do JSON (já validado)
    const payload = JSON.parse(event.body || '{}');
    logger.info("Processando atualização de installments", {
      clientId,
      orderId,
      installments: payload.installments,
    });

    // Prepara a chave do item
    const key = marshall({
      ClientID: parseInt(clientId),
      OrderId: parseInt(orderId),
    });

    // Prepara o update expression para atualizar apenas o campo Installments
    const updateExpression = 'SET Installments = :installments, UpdatedAt = :updatedAt';
    const expressionAttributeValues = marshall({
      ':installments': payload.installments,
      ':updatedAt': new Date().toISOString(),
    });

    // Atualiza o item no DynamoDB
    await dynamoClient.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }));

    logger.info("Installments atualizado com sucesso", {
      clientId: parseInt(clientId),
      orderId: parseInt(orderId),
      installments: payload.installments,
    });

    // Retorna sucesso com os dados atualizados
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        clientId: parseInt(clientId),
        orderId: parseInt(orderId),
        installments: payload.installments,
      }),
    };

  } catch (err) {
    logger.error("Erro ao atualizar installments", { error: err });

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