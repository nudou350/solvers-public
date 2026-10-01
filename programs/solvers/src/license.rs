//! Leitura de assets de licença (Metaplex Core) compartilhada por `review` e `resale`.
//!
//! Só lê: quem chama confere o dono da conta (`owner = mpl_core::ID`) antes. Nenhuma função aqui usa
//! índice, `unwrap` ou `expect`; dado truncado vira erro, nunca pânico.
use anchor_lang::prelude::*;
use mpl_core::accounts::{BaseAssetV1, PluginHeaderV1};
use mpl_core::types::{Key as CoreKey, PluginAuthority, PluginType, UpdateAuthority};
use mpl_core::{DataBlob, PluginRegistryV1Safe};

use crate::errors::SolversError;

/// Lê o `BaseAssetV1`. `None` quando a conta não é um asset vivo (vazia, `Uninitialized` de um asset
/// queimado ou outro tipo de conta do mpl-core); erro quando diz ser `AssetV1` mas os dados não decodificam.
fn base_asset(data: &[u8]) -> Result<Option<BaseAssetV1>> {
    if data.first() != Some(&(CoreKey::AssetV1 as u8)) {
        return Ok(None);
    }
    BaseAssetV1::from_bytes(data)
        .map(Some)
        .map_err(|_| error!(SolversError::InvalidLicenseAccount))
}

/// A carteira `author` é a dona do asset e ele pertence à coleção do solver.
pub(crate) fn holds_license(
    asset: &AccountInfo,
    author: &Pubkey,
    collection: &Pubkey,
) -> Result<bool> {
    let data = asset.try_borrow_data()?;
    Ok(match base_asset(&data)? {
        Some(base) => {
            base.owner == *author
                && base.update_authority == UpdateAuthority::Collection(*collection)
        }
        None => false,
    })
}

/// Foto de um asset de licença para a revenda.
pub(crate) struct LicenseAsset {
    pub owner: Pubkey,
    pub update_authority: UpdateAuthority,
    /// Authority do plugin `TransferDelegate`; `None` se o asset não tem o plugin.
    pub transfer_delegate: Option<PluginAuthority>,
}

impl LicenseAsset {
    /// O asset é da coleção do solver (`UpdateAuthority::Collection`).
    pub(crate) fn in_collection(&self, collection: &Pubkey) -> bool {
        self.update_authority == UpdateAuthority::Collection(*collection)
    }

    /// O `TransferDelegate` aponta para `authority` (a PDA `market_authority`).
    pub(crate) fn delegated_to(&self, authority: &Pubkey) -> bool {
        matches!(&self.transfer_delegate, Some(PluginAuthority::Address { address }) if address == authority)
    }
}

/// Lê dono, autoridade de update e `TransferDelegate` do asset. `None` = não é um asset vivo.
/// Registro de plugins truncado ou ilegível é erro (`InvalidLicenseAccount`).
pub(crate) fn read_license(asset: &AccountInfo) -> Result<Option<LicenseAsset>> {
    let data = asset.try_borrow_data()?;
    let Some(base) = base_asset(&data)? else {
        return Ok(None);
    };
    let invalid = || error!(SolversError::InvalidLicenseAccount);
    let mut transfer_delegate = None;
    // Sem bytes depois do asset = sem plugins (o mesmo critério do `fetch_plugin` do mpl-core).
    if let Some(rest) = data.get(base.len()..).filter(|r| !r.is_empty()) {
        let header = PluginHeaderV1::from_bytes(rest).map_err(|_| invalid())?;
        let offset = usize::try_from(header.plugin_registry_offset).map_err(|_| invalid())?;
        let registry = PluginRegistryV1Safe::from_bytes(data.get(offset..).ok_or_else(invalid)?)
            .map_err(|_| invalid())?;
        transfer_delegate = registry
            .registry
            .into_iter()
            .find(|r| r.plugin_type == PluginType::TransferDelegate as u8)
            .map(|r| r.authority);
    }
    Ok(Some(LicenseAsset {
        owner: base.owner,
        update_authority: base.update_authority,
        transfer_delegate,
    }))
}
