<template>
  <SidebarContextRootContainer>
    <template #title>Withdraw {{ symbol0 }} / {{ symbol1 }}</template>

    <div class="bg-[#C5CCE1] bg-opacity-[0.15] mt-10 p-8 h-full">
      <h3 class="text-primary-gray text-xs font-semibold mb-2.5">
        Amounts to withdraw
      </h3>

      <input-numeric
        v-model="amount0"
        :placeholder="`${symbol0} to withdraw`"
        :error="errors.amount0.message"
      >
        <template v-if="!isMaxAmount0" #suffix>
          <div class="absolute mt-2 top-0 right-0 mr-4">
            <button
              type="button"
              class="text-primary-blue-dark font-semibold text-sm hover:text-primary-blue-hover"
              @click="toggle0"
            >
              Max
            </button>
          </div>
        </template>
      </input-numeric>

      <input-numeric
        v-model="amount1"
        :placeholder="`${symbol1} to supply`"
        class="mt-5"
        :error="errors.amount1.message"
      >
        <template v-if="!isMaxAmount1" #suffix>
          <div class="absolute mt-2 top-0 right-0 mr-4">
            <button
              type="button"
              class="text-primary-blue-dark font-semibold text-sm hover:text-primary-blue-hover"
              @click="toggle1"
            >
              Max
            </button>
          </div>
        </template>
      </input-numeric>

      <div class="flex flex-shrink-0 mt-10">
        <ButtonCTA
          class="w-full"
          :disabled="!isValid || pending"
          :loading="pending"
          @click="cast"
        >
          Withdraw
        </ButtonCTA>
      </div>

      <ValidationErrors :error-messages="errorMessages" class="mt-6" />
    </div>
  </SidebarContextRootContainer>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "@nuxtjs/composition-api";
import InputNumeric from "~/components/common/input/InputNumeric.vue";
import { useBalances } from "~/composables/useBalances";
import { useNotification } from "~/composables/useNotification";
import { useBigNumber } from "~/composables/useBigNumber";
import { useFormatting } from "~/composables/useFormatting";
import { useValidators } from "~/composables/useValidators";
import { useValidation } from "~/composables/useValidation";
import { useToken } from "~/composables/useToken";
import { useParsing } from "~/composables/useParsing";
import { useMaxAmountActive } from "~/composables/useMaxAmountActive";
import { useWeb3 } from "@instadapp/vue-web3";
import ToggleButton from "~/components/common/input/ToggleButton.vue";
import { useDSA } from "~/composables/useDSA";
import ButtonCTA from "~/components/common/input/ButtonCTA.vue";
import Button from "~/components/Button.vue";
import { useSidebar } from "~/composables/useSidebar";
import DSA from "dsa-connect";
import { useUniversePosition } from "~/composables/protocols/useUniversePosition";

export default defineComponent({
  components: { InputNumeric, ToggleButton, ButtonCTA, Button },
  props: {
    vault: { type: String, required: true }
  },
  setup(props) {
    const { close } = useSidebar();
    const { account } = useWeb3();
    const { dsa } = useDSA();
    const { getTokenByKey, valInt } = useToken();
    const { getBalanceByKey, fetchBalances } = useBalances();
    const { formatNumber, formatUsdMax, formatUsd } = useFormatting();
    const { isZero, gt } = useBigNumber();
    const { parseSafeFloat } = useParsing();
    const {
      showPendingTransaction,
      showWarning,
      showConfirmedTransaction
    } = useNotification();

    const { dualVaults, refreshPosition } = useUniversePosition();
    const selectedVault = computed(() =>
      dualVaults.value.find(v => v.vaultAddress === props.vault)
    );
    const balance0 = computed(
      () => selectedVault.value ? selectedVault.value.token0Deposit : '0'
    )
    const balance1 = computed(
      () => selectedVault.value ? selectedVault.value.token1Deposit : '0'
    )

    const amount0 = ref("");
    const amount1 = ref("");
    const amount0Parsed = computed(() => parseSafeFloat(amount0.value));
    const amount1Parsed = computed(() => parseSafeFloat(amount1.value));

    const token0 = computed(() =>
      selectedVault.value
        ? getTokenByKey(selectedVault.value.token0.symbol.toLowerCase())
        : null
    );
    const token1 = computed(() =>
      selectedVault.value
        ? getTokenByKey(selectedVault.value.token1.symbol.toLowerCase())
        : null
    );
    const symbol0 = computed(() => token0.value?.symbol);
    const decimals0 = computed(() => token0.value?.decimals);

    const symbol1 = computed(() => token1.value?.symbol);
    const decimals1 = computed(() => token1.value?.decimals);

    const { toggle: toggle0, isMaxAmount: isMaxAmount0 } = useMaxAmountActive(
      amount0,
      balance0
    );
    const { toggle: toggle1, isMaxAmount: isMaxAmount1 } = useMaxAmountActive(
      amount1,
      balance1
    );

    function validateAmount(symbol: string, amountParsed, balance = null, checkZero = false) {
      const mergedOptions = { msg: `Your amount exceeds your maximum limit of ${symbol}.` }

      if (checkZero && isZero(amountParsed)) {
        return `Please provide a valid amount of ${symbol}.`;
      } else if (balance !== null && gt(amountParsed, balance)) {
        return mergedOptions.msg;
      }

      return null;
    }

    const {  validateIsLoggedIn } = useValidators();
    const errors = computed(() => {
      const hasAmount0Value = !isZero(amount0.value);
      const hasAmount1Value = !isZero(amount1.value);

      return {
        amount0: {
          message: validateAmount(symbol0.value, amount0Parsed.value, balance0.value, !hasAmount1Value),
          show: hasAmount0Value
        },
        amount1: {
          message: validateAmount(symbol1.value, amount1Parsed.value, balance1.value, !hasAmount0Value),
          show: hasAmount1Value
        },
        auth: { message: validateIsLoggedIn(!!account.value), show: true }
      };
    });
    const { errorMessages, isValid } = useValidation(errors);

    const pending = ref(false);

    async function cast() {
      pending.value = true;

      const amount0 = isMaxAmount0.value
        ? dsa.value.maxValue
        : valInt(amount0Parsed.value, decimals0.value);
      const amount1 = isMaxAmount1.value
        ? dsa.value.maxValue
        : valInt(amount1Parsed.value, decimals1.value);

      const spells = dsa.value.Spell();
      const amounts = [amount0, amount1];

      spells.add({
        //@ts-ignore
        connector: "UNIVERSE-A",
        method: "withdraw",
        args: [props.vault, ...amounts, [0, 0], [0, 0]]
      });

      try {
        const txHash = await (dsa.value as DSA).cast({
          spells,
          from: account.value,
          onReceipt: async receipt => {
            showConfirmedTransaction(receipt.transactionHash);

            await fetchBalances(true);
            await refreshPosition();
          }
        });

        showPendingTransaction(txHash);
      } catch (error) {
        showWarning(error.message);
      }

      pending.value = false;

      close();
    }

    return {
      selectedVault,
      pending,
      cast,
      errors,
      formatNumber,
      formatUsdMax,
      formatUsd,
      toggle0,
      amount0,
      token0,
      symbol0,
      balance0,
      isMaxAmount0,
      toggle1,
      amount1,
      token1,
      symbol1,
      balance1,
      isMaxAmount1,
      errorMessages,
      isValid
    };
  }
});
</script>
