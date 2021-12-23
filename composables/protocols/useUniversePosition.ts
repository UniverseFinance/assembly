import BigNumber from 'bignumber.js';
import { useWeb3 } from '@instadapp/vue-web3';
import { ref, useContext, watch } from '@nuxtjs/composition-api';

import universeABI from '~/abis/read/universe.json';
import addresses from '~/constant/addresses';
import tokens from '~/constant/tokens';

import { useBigNumber } from '../useBigNumber';
import { useDSA } from '../useDSA';
import useEventBus from '../useEventBus';

const resolver = addresses.mainnet.resolver.universe;

const allTokens = tokens.mainnet.allTokens.map(token => token.address);

const singleVaults = ref<SingleVault[]>([]);
const dualVaults = ref<DualVault[]>([]);
const totalDeposit = ref<Number>(0);
const totalUNTReward = ref<Number>(0);

interface VaultModel {
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  tokenIndex: 0 | 1;
  vaultName: string;
  vaultAddress: string;
  feeAprLifetime: string;
  feeApr24h: string;
  netReturn: string;
  netApr: string;
  price: string;
  untReward: number;
  totalUnclaimedUnt: number;
}

interface TokenModel {
  symbol: string;
  address: string;
  decimals: number;
}

interface DualVaultModel {
  token0: TokenModel;
  token1: TokenModel;
  vaultName: string;
  vaultAddress: string;
  vaultProxyAddress?: string;
  feeAprLifetime: string;
  feeApr24h: string;
  netReturn: string;
  netApr: string;
  untReward: number;
  totalUnclaimedUnt: number;
}

type SingleVault = VaultModel & {
  deposit: string;
  depositInUsd: string;
  link: string;
  price: string;
};

type DualVault = DualVaultModel & {
  token0Deposit: string;
  token1Deposit: string;
  token0DepositInUsd: string;
  token1DepositInUsd: string;
  link: string;
  price0: string;
  price1: string;
};


export function useUniversePosition() {
  const { $axios } = useContext();
  const { times } = useBigNumber();
  const { library } = useWeb3();
  const { activeAccount } = useDSA();
  const { onEvent } = useEventBus();
  const fetchAllVaults = () => {
      const fetchSingleVaults = $axios.$get<{ data: VaultModel[] }>(
        "https://api.webwxk.com/singleVault/universe/instadapp/vaultList"
      );
      const fetchDualVaults = $axios.$get<{ data: DualVault[] }>(
        "https://defi-test-api.webwxk.com/dualVault/universe/v2/instadapp/dualVaultList"
      );
      const tokenExist = (address: string) => 
        allTokens.some((tokenAddress) => new RegExp(tokenAddress, 'i').test(address))
      
      return Promise.all([
        fetchSingleVaults,
        fetchDualVaults
      ]).then(([{data: singleVaults }, { data: dualVaults }]) => {
        const availableSingleVaults = singleVaults.filter((vault) => tokenExist(vault.tokenAddress))
        const availableDualVaults = dualVaults.filter((vault) => tokenExist(vault.token0.address) && tokenExist(vault.token1.address))
        
        return [availableSingleVaults, availableDualVaults];
      });
  }
  const getVaultLink = (type: 'single' | 'dual', vaultAddress: string, account?: string) => `https://universe.finance/${type}/vault/${vaultAddress}?watch=${account}`
  const calcTokenDeposit = (amount: any, decimals: number, price: string) => {
    const deposit = new BigNumber(amount)
          .dividedBy(10 ** decimals)
          .toFixed();
    const depositInUsd = times(
      deposit,
      price === "0" ? 1 : price
    ).toFixed();
    
    return [deposit, depositInUsd]
  }
  const fetchPosition = async () => {
    const [availableSingleVaults, availableDualVaults] = await fetchAllVaults();

    if (!library.value) {
      return;
    }

    if (!activeAccount.value) {
      singleVaults.value = availableSingleVaults.map(vault => {
        return {
          ...vault,
          link: getVaultLink('single', vault.vaultAddress),
          deposit: "0",
          depositInUsd: "0"
        };
      });
      dualVaults.value = availableDualVaults.map(vault => {
        return {
          ...vault,
          link: getVaultLink('dual', vault.vaultAddress),
          token0Deposit: '0',
          token1Deposit: '0',
          token0DepositInUsd: '0',
          token1DepositInUsd: '0',
        };
      })

      return;
    }

    const resolverInstance = new library.value.eth.Contract(
      universeABI as any,
      resolver
    );

    const vaultAddressArr = [
      ...new Set(availableSingleVaults.map(v => v.vaultAddress)),
      ...new Set(availableDualVaults.map(v => v.vaultAddress))
    ];

    const account = activeAccount.value.address;
    const rawData = await resolverInstance.methods
      .getUserShareAmountList(vaultAddressArr, account)
      .call();
    const vaultsAmounts = vaultAddressArr.map((address, index) => ({
      vaultAddress: address,
      token0Amount: rawData[index][0],
      token1Amount: rawData[index][1]
    }));
    let totalDepositInUsd = 0;
    let untReward = 0;

    const newSingleVaults = [];
    const newDualVaults = [];

    availableSingleVaults.forEach(vault => {
      const amounts = vaultsAmounts.find(
        vm => vm.vaultAddress === vault.vaultAddress
      );

      if (amounts) {
        const amount =
          vault.tokenIndex === 0 ? amounts.token0Amount : amounts.token1Amount;
        const [deposit, depositInUsd] = calcTokenDeposit(amount, vault.tokenDecimals, vault.price)
        totalDepositInUsd += Number(depositInUsd);
        untReward += Number(vault.totalUnclaimedUnt);

        const item = {
          ...vault,
          link: getVaultLink('single', vault.vaultAddress, account),
          deposit,
          depositInUsd
        };
        newSingleVaults.push(item);
      }
    });
    availableDualVaults.forEach(vault => {
      const amounts = vaultsAmounts.find(
        vm => vm.vaultAddress === vault.vaultAddress
      );

      if (amounts) {
        const [token0Deposit, token0DepositInUsd] = calcTokenDeposit(amounts.token0Amount, vault.token0.decimals, vault.price0);
        const [token1Deposit, token1DepositInUsd] = calcTokenDeposit(amounts.token1Amount, vault.token1.decimals, vault.price1);
        
        totalDepositInUsd += Number(token0DepositInUsd) + Number(token1DepositInUsd);
        untReward += Number(vault.totalUnclaimedUnt);

        const item = {
          ...vault,
          link: getVaultLink('dual', vault.vaultAddress, account),
          token0Deposit,
          token1Deposit,
          token0DepositInUsd,
          token1DepositInUsd
        };
        newDualVaults.push(item);
      }
    });

    singleVaults.value = newSingleVaults;
    totalDeposit.value = totalDepositInUsd;
    totalUNTReward.value = untReward;
    dualVaults.value = newDualVaults;
  };

  const refreshPosition = async () => {
    await fetchPosition();
  };

  onEvent("protocol::universe::refresh", refreshPosition);

  watch(
    library,
    async val => {
      if (val) {
        refreshPosition();
      }
    },
    { immediate: true }
  );

  watch(
    activeAccount,
    async val => {
      if (val) {
        refreshPosition();
      }
    },
    { immediate: true }
  );

  return {
    singleVaults,
    dualVaults,
    totalDeposit,
    totalUNTReward,
    refreshPosition
  };
}
