//! EIP-1967 proxy for the CDM ContractRegistry.
//!
//! This contract owns the registry's stable on-chain address. It holds no
//! logic of its own: every call is forwarded via `delegate_call` to the
//! implementation address stored at the EIP-1967 implementation slot, so the
//! implementation's methods run against this proxy's storage. Upgrades go
//! through the implementation's `setCode`, which rewrites that slot — the
//! proxy itself never needs to change.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

#[cfg(test)]
mod tests;

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 262144)]
mod registry_proxy {
    use alloc::vec;
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};
    use pvm_contract_sdk::{Address, CallFlags, EmptyError, HostApi, Lazy};

    pub struct RegistryProxy {
        /// No ordinary fields: slots 0.. belong to the implementation's
        /// storage, reached through `delegate_call`.
        #[slot(raw = IMPLEMENTATION_SLOT)]
        implementation: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
    }

    impl RegistryProxy {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self, implementation: Address) {
            let mut deployer = [0u8; 20];
            self.host().caller(&mut deployer);
            self.implementation.set(&implementation);
            self.admin.set(&Address(deployer));
        }

        /// Forward any call — the proxy declares no methods, so every
        /// selector lands here — and bubble the implementation's return or
        /// revert data unchanged.
        #[pvm_contract_sdk::fallback]
        pub fn fallback(&mut self) -> Result<(), EmptyError> {
            let host = self.host();

            let input_len = host.call_data_size() as usize;
            let mut input = vec![0u8; input_len];
            host.call_data_copy(&mut input, 0);

            let target = self.implementation.get();
            let result =
                host.delegate_call_evm(CallFlags::empty(), &target.0, u64::MAX, &input, None);

            let output_len = host.return_data_size() as usize;
            let mut output = vec![0u8; output_len];
            let mut output_ref: &mut [u8] = &mut output;
            host.return_data_copy(&mut output_ref, 0);

            if result.is_err() {
                host.revert(&output);
            }
            host.return_value(&output);

            // `return_value` diverges on-chain; on host targets (unit tests)
            // it records the payload and control returns here.
            #[cfg(not(target_arch = "riscv64"))]
            Ok(())
        }
    }
}
