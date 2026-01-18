import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import 'source-map-support/register';

const logger = new Logger({
  serviceName: 'create-order',
  logLevel: 'INFO',
});

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

const tracer = new Tracer({ serviceName: 'createOrder' });
// Instrument the AWS SDK client
const client = tracer.captureAWSv3Client(dynamoClient);

function generateOrderId(): number {
  // Gera um ID único baseado em timestamp + número aleatório
  // Isso garante que não haverá colisões mesmo em alta concorrência
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

export const handler = async (
  event: APIGatewayEvent,
  _: Context
): Promise<APIGatewayProxyResult> => {

  try {
    // Validação agora é feita pelo API Gateway Request Validation
    // Apenas fazemos parse do JSON (já validado)
    const order = JSON.parse(event.body!);
    logger.info("Processando pedido", { order });

    // Gera o OrderId
    const orderId = generateOrderId();

    // Prepara o item para inserção no DynamoDB (em formato JavaScript)
    const item = {
      ClientId: order.clientId,
      OrderId: orderId,
      Items: order.items,
      PaymentMethod: order.paymentMethod,
      Installments: order.installments,
      CreatedAt: new Date().toISOString(),
    };

    // Converte para formato DynamoDB usando marshall
    const marshalledItem = marshall(item);

    // Insere no DynamoDB
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshalledItem,
    }));

    logger.info("Pedido criado com sucesso", {
      clientId: order.clientId,
      orderId: orderId,
    });

    // Retorna sucesso com o OrderId
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        orderId: orderId,
        clientId: order.clientId,
      }),
    };

  } catch (err) {
    logger.error("Erro ao processar pedido", { error: err });

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