import * as Ethers from "ethers";
import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client-nodejs";
import { LitNetwork } from "@lit-protocol/constants";
import {
  LitAbility,
  LitActionResource,
  LitPKPResource,
  createSiweMessageWithRecaps,
  generateAuthSig,
} from "@lit-protocol/auth-helpers";
import * as StellarBase from "@stellar/stellar-base";

const getEnv = (name: string): string => {
  const env = process.env[name];
  if (env === undefined || env === "")
    throw new Error(
      `${name} ENV is not defined, please define it in the .env file`
    );
  return env;
};

const STELLAR_SECRET = getEnv("STELLAR_SECRET");
const STELLAR_ACCOUNT_SEQUENCE_NUMBER = getEnv(
  "STELLAR_ACCOUNT_SEQUENCE_NUMBER"
);
const ETHEREUM_PRIVATE_KEY = getEnv("ETHEREUM_PRIVATE_KEY");
const LIT_ACTION_IPFS_CID = getEnv("LIT_ACTION_IPFS_CID");
const LIT_PKP_PUBLIC_KEY = getEnv("LIT_PKP_PUBLIC_KEY");

let litNodeClient: LitNodeClientNodeJs | undefined = undefined;

try {
  const stellarKeyPair = StellarBase.Keypair.fromSecret(STELLAR_SECRET);
  const stellarAccount = new StellarBase.Account(
    stellarKeyPair.publicKey(),
    STELLAR_ACCOUNT_SEQUENCE_NUMBER
  );

  const stellarAuthTx = new StellarBase.TransactionBuilder(stellarAccount, {
    fee: StellarBase.BASE_FEE,
    networkPassphrase: StellarBase.Networks.TESTNET,
  })
    .setTimeout(60 * 60 * 24) // 24 hours
    .build();
  stellarAuthTx.sign(stellarKeyPair);

  litNodeClient = new LitNodeClientNodeJs({
    litNetwork: LitNetwork.Cayenne,
  });
  await litNodeClient.connect();

  const ethersWallet = new Ethers.Wallet(
    ETHEREUM_PRIVATE_KEY,
    new Ethers.providers.JsonRpcProvider(
      "https://chain-rpc.litprotocol.com/http"
    )
  );
  const sessionSigs = await litNodeClient.getSessionSigs({
    chain: "ethereum",
    expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
    resourceAbilityRequests: [
      {
        resource: new LitPKPResource("*"),
        ability: LitAbility.PKPSigning,
      },
      {
        resource: new LitActionResource("*"),
        ability: LitAbility.LitActionExecution,
      },
    ],
    authNeededCallback: async ({
      resourceAbilityRequests,
      expiration,
      uri,
    }) => {
      const toSign = await createSiweMessageWithRecaps({
        // @ts-ignore
        uri,
        // @ts-ignore
        expiration,
        // @ts-ignore
        resources: resourceAbilityRequests,
        walletAddress: await ethersWallet.getAddress(),
        nonce: await litNodeClient!.getLatestBlockhash(),
        litNodeClient,
      });
      return await generateAuthSig({
        signer: ethersWallet,
        toSign,
      });
    },
  });

  const litPkpSignature = await litNodeClient.executeJs({
    sessionSigs,
    ipfsId: LIT_ACTION_IPFS_CID,
    jsParams: {
      stellarPublicKey: stellarKeyPair.publicKey(),
      stellarAuthTxHash: stellarAuthTx.hash(),
      stellarAuthTxSignature: stellarAuthTx.signatures[0].signature(),
      stellarAccountSequenceNumber: STELLAR_ACCOUNT_SEQUENCE_NUMBER,
      litPkpPublicKey: LIT_PKP_PUBLIC_KEY,
    },
  });
  console.log("litPkpSignature: ", litPkpSignature);
} catch (error) {
  console.error(error);
} finally {
  litNodeClient!.disconnect();
}