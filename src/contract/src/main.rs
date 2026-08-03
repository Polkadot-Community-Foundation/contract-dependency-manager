//! CDM ContractRegistry — implementation contract.
//!
//! Deployed behind `contract-registry-proxy` (EIP-1967), which delegate-calls
//! every method here against the proxy's storage. Upgrades therefore keep the
//! proxy's address: `setCode` points the proxy at a new implementation. The
//! admin, implementation, and frozen flags live at fixed pseudo-random slots
//! (see `contract_registry_core::slots`) so future implementations can
//! reshape the ordinary storage fields without touching them.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// The `#[contract]` macro injects `extern crate alloc` in on-chain and test
// builds, but not in the abi-gen pass, where `types` still needs it.
#[cfg(all(feature = "abi-gen", not(test)))]
extern crate alloc;

mod types;

#[cfg(test)]
mod tests;

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 262144)]
mod contract_registry {
    use super::types::*;
    use alloc::string::String;
    use alloc::vec::Vec;
    use contract_registry_core::MAX_PAGE_LIMIT;
    use contract_registry_core::naming::validate_contract_name;
    use contract_registry_core::slots::{ADMIN_SLOT, FROZEN_SLOT, IMPLEMENTATION_SLOT};
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping, StorageVec};

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Published {
        /// Indexed (so only its keccak hash lands in the topic): `emit` is
        /// not generated for events with dynamic non-indexed fields.
        #[indexed]
        pub name: String,
        pub version: u32,
        pub address: Address,
    }

    /// EIP-1967 standard event, so proxy-aware tooling picks up upgrades.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Upgraded {
        #[indexed]
        pub implementation: Address,
    }

    /// EIP-1967 standard event.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct AdminChanged {
        pub previous_admin: Address,
        pub new_admin: Address,
    }

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct FrozenSet {
        pub frozen: bool,
    }

    pub struct ContractRegistry {
        /// Registered names in registration order; drives `getContracts` paging.
        names: StorageVec<String>,
        /// Name → owner and published version count.
        info: Mapping<String, NamedContractInfo>,
        /// name → version → published contract address.
        address_of: Mapping<String, Mapping<u32, Address>>,
        /// name → version → metadata URI (Bulletin/IPFS).
        metadata_uri_of: Mapping<String, Mapping<u32, String>>,
        /// Fixed-slot admin state, shared with the proxy.
        #[slot(raw = IMPLEMENTATION_SLOT)]
        implementation: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
        #[slot(raw = FROZEN_SLOT)]
        frozen: Lazy<bool>,
    }

    impl ContractRegistry {
        /// Runs only when the implementation itself is deployed. Through the
        /// proxy, admin is initialized by the proxy's constructor instead.
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            let deployer = self.caller();
            self.admin.set(&deployer);
        }

        // ─── Admin & longevity ───────────────────────────────────────────

        /// The address allowed to upgrade, freeze, and import registry state.
        #[pvm_contract_sdk::method]
        pub fn get_admin(&self) -> Address {
            self.admin.get()
        }

        /// Transfer admin permissions.
        #[pvm_contract_sdk::method]
        pub fn set_admin(&mut self, new_admin: Address) -> Result<(), Error> {
            self.require_admin()?;
            let previous_admin = self.admin.get();
            self.admin.set(&new_admin);
            AdminChanged {
                previous_admin,
                new_admin,
            }
            .emit(self.host());
            Ok(())
        }

        /// Upgrade in place: point the proxy at a new implementation while
        /// keeping the registry's address and state.
        #[pvm_contract_sdk::method]
        pub fn set_code(&mut self, new_implementation: Address) -> Result<(), Error> {
            self.require_admin()?;
            self.implementation.set(&new_implementation);
            Upgraded {
                implementation: new_implementation,
            }
            .emit(self.host());
            Ok(())
        }

        /// The implementation the proxy currently delegates to.
        #[pvm_contract_sdk::method]
        pub fn get_code(&self) -> Address {
            self.implementation.get()
        }

        /// Freeze the registry: every state-changing call except the admin's
        /// fails with `ContractFrozen()` until `unfreeze`. Reads always work.
        #[pvm_contract_sdk::method]
        pub fn freeze(&mut self) -> Result<(), Error> {
            self.require_admin()?;
            self.frozen.set(&true);
            FrozenSet { frozen: true }.emit(self.host());
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn unfreeze(&mut self) -> Result<(), Error> {
            self.require_admin()?;
            self.frozen.set(&false);
            FrozenSet { frozen: false }.emit(self.host());
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn is_frozen(&self) -> bool {
            self.frozen.get()
        }

        /// Import existing registry data into a fresh registry deployment.
        #[pvm_contract_sdk::method]
        pub fn admin_import_contracts(
            &mut self,
            contracts: Vec<ImportContract>,
        ) -> Result<(), Error> {
            self.require_admin()?;
            for contract in contracts {
                self.import_contract(contract)?;
            }
            Ok(())
        }

        // ─── Publishing ──────────────────────────────────────────────────

        /// Publish the next version of `contract_name`. The caller may
        /// publish if the name is unregistered (registering it, becoming its
        /// owner) or if they already own it.
        #[pvm_contract_sdk::method]
        pub fn publish_latest(
            &mut self,
            contract_name: String,
            contract_address: Address,
            metadata_uri: String,
        ) -> Result<(), Error> {
            self.require_unfrozen()?;
            validate_contract_name(&contract_name)?;

            let caller = self.caller();
            let mut info = self.info.get(&contract_name);
            if info.version_count == 0 {
                self.names.push(&contract_name);
                info.owner = caller;
            } else if info.owner != caller {
                return Err(Unauthorized.into());
            }

            let version = info.version_count;
            info.version_count = version.checked_add(1).ok_or(VersionOverflow)?;
            self.info.insert(&contract_name, &info);

            self.address_of
                .view_mut(&contract_name)
                .insert(&version, &contract_address);
            self.metadata_uri_of
                .view_mut(&contract_name)
                .insert(&version, &metadata_uri);

            Published {
                name: contract_name,
                version,
                address: contract_address,
            }
            .emit(self.host());
            Ok(())
        }

        // ─── Queries ─────────────────────────────────────────────────────

        /// Latest published address for `contract_name`, as `(found, value)`.
        /// This is the hot path used by `cdm::import!` runtime lookups.
        #[pvm_contract_sdk::method]
        pub fn get_address(&self, contract_name: String) -> (bool, Address) {
            match self.latest_version(&contract_name) {
                Some(version) => (true, self.address_of.view(&contract_name).get(&version)),
                None => (false, Address::ZERO),
            }
        }

        /// Latest metadata URI for `contract_name`, as `(found, value)`.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri(&self, contract_name: String) -> (bool, String) {
            match self.latest_version(&contract_name) {
                Some(version) => (
                    true,
                    self.metadata_uri_of.view(&contract_name).get(&version),
                ),
                None => (false, String::new()),
            }
        }

        #[pvm_contract_sdk::method]
        pub fn get_address_at_version(
            &self,
            contract_name: String,
            version: u32,
        ) -> (bool, Address) {
            if version >= self.info.get(&contract_name).version_count {
                return (false, Address::ZERO);
            }
            (true, self.address_of.view(&contract_name).get(&version))
        }

        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri_at_version(
            &self,
            contract_name: String,
            version: u32,
        ) -> (bool, String) {
            if version >= self.info.get(&contract_name).version_count {
                return (false, String::new());
            }
            (
                true,
                self.metadata_uri_of.view(&contract_name).get(&version),
            )
        }

        /// The contract name at a registration index; empty when out of range.
        #[pvm_contract_sdk::method]
        pub fn get_contract_name_at(&self, index: u32) -> String {
            self.names.try_get(index as u64).unwrap_or_default()
        }

        /// A page of latest contract entries by registration index, as
        /// `(total, entries)`.
        #[pvm_contract_sdk::method]
        pub fn get_contracts(&self, start: u32, count: u32) -> (u32, Vec<ContractEntry>) {
            let total = self.names.len() as u32;
            let end = start.saturating_add(count.min(MAX_PAGE_LIMIT)).min(total);
            let mut entries = Vec::new();
            for index in start..end {
                if let Some(name) = self.names.try_get(index as u64) {
                    if let Some(entry) = self.latest_entry(name) {
                        entries.push(entry);
                    }
                }
            }
            (total, entries)
        }

        #[pvm_contract_sdk::method]
        pub fn get_owner(&self, contract_name: String) -> Address {
            self.info.get(&contract_name).owner
        }

        #[pvm_contract_sdk::method]
        pub fn get_version_count(&self, contract_name: String) -> u32 {
            self.info.get(&contract_name).version_count
        }

        #[pvm_contract_sdk::method]
        pub fn get_contract_count(&self) -> u32 {
            self.names.len() as u32
        }

        // ─── Internals ───────────────────────────────────────────────────

        fn caller(&self) -> Address {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            Address(caller)
        }

        fn require_admin(&self) -> Result<(), Error> {
            if self.caller() != self.admin.get() {
                return Err(UnauthorizedAdmin.into());
            }
            Ok(())
        }

        /// Frozen blocks every mutation for everyone but the admin.
        fn require_unfrozen(&self) -> Result<(), Error> {
            if self.frozen.get() && self.caller() != self.admin.get() {
                return Err(ContractFrozen.into());
            }
            Ok(())
        }

        /// Latest published version index, `None` for unregistered names.
        fn latest_version(&self, contract_name: &String) -> Option<u32> {
            self.info.get(contract_name).version_count.checked_sub(1)
        }

        fn latest_entry(&self, name: String) -> Option<ContractEntry> {
            let info = self.info.get(&name);
            let version = info.version_count.checked_sub(1)?;
            Some(ContractEntry {
                version,
                address: self.address_of.view(&name).get(&version),
                metadata_uri: self.metadata_uri_of.view(&name).get(&version),
                owner: info.owner,
                name,
            })
        }

        fn import_contract(&mut self, contract: ImportContract) -> Result<(), Error> {
            let contract_name = contract.contract_name;
            validate_contract_name(&contract_name)?;
            if contract.versions.is_empty() {
                return Err(ImportVersionsEmpty.into());
            }
            if self.info.get(&contract_name).version_count != 0 {
                return Err(ImportContractExists.into());
            }

            let mut addresses = self.address_of.view_mut(&contract_name);
            let mut metadata_uris = self.metadata_uri_of.view_mut(&contract_name);
            let mut version_count: u32 = 0;
            for version in contract.versions {
                addresses.insert(&version_count, &version.address);
                metadata_uris.insert(&version_count, &version.metadata_uri);
                version_count = version_count.checked_add(1).ok_or(VersionOverflow)?;
            }

            self.names.push(&contract_name);
            self.info.insert(
                &contract_name,
                &NamedContractInfo {
                    owner: contract.owner,
                    version_count,
                },
            );
            Ok(())
        }
    }
}
